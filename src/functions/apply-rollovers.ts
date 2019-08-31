import * as ynab from "ynab"

import { error, getMonth, log, reduceByProp } from "../helpers"
import { api, BudgetValue, debug, Storage, StorageKey } from "../index"

export async function applyRollovers() {
	const storage = await Storage

	const accountId = await storage.getItem<string>(StorageKey.account).then(async (id) => {
		if (id) {
			return id
		}

		const accounts = await api.accounts.getAccounts(BudgetValue.budget)
		const account = accounts.data.accounts.find((a) => a.name === BudgetValue.budgetRollover)

		if (!account) {
			throw new Error(`The target account was not found.`)
		}

		await storage.setItem(StorageKey.account, account.id)

		return account.id
	})

	const payeeId = await storage.getItem<string>(StorageKey.payee).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(BudgetValue.budget)
		const payee = payees.data.payees.find((a) => a.name === BudgetValue.budgetRollover)

		if (!payee) {
			throw new Error(`No rollover payee found.`)
		}

		await storage.setItem(StorageKey.payee, payee.id)

		return payee.id
	})

	const [paymentsGroupId, tbbCategoryId] = await storage
		.getItem<[string, string]>(StorageKey.groupAndTbb)
		.then(async (ids) => {
			if (ids) {
				return ids
			}

			const groupsData = await api.categories.getCategories(BudgetValue.budget)
			const groups = groupsData.data.category_groups

			const group = groups.find((g) => g.name === BudgetValue.creditCardPayments)
			const tbb = groups.reduce<ynab.Category | undefined>((trans, next) => {
				if (trans) {
					return trans
				}

				return next.categories.find((c) => c.name === BudgetValue.toBeBudgeted)
			}, undefined)

			if (!group || !tbb) {
				throw new Error(`Payments account group or tbb category not found.`)
			}

			await storage.setItem(StorageKey.groupAndTbb, [group.id, tbb.id])

			return [group.id, tbb.id]
		})

	if (!accountId || !payeeId || !paymentsGroupId || !tbbCategoryId) {
		error(
			`Failed to get account (${accountId}), payee ${payeeId}, payments group ${paymentsGroupId}, or tbb category ID ${tbbCategoryId}.`
		)

		process.exit(-1)
	}

	const startYear = 2019
	const start = new Date(`${startYear}-01-01`)
	const end = new Date()
	const delta =
		end.getFullYear() * 12 + end.getMonth() - (start.getFullYear() * 12 + start.getMonth())

	const cachedTransactions =
		debug && (await storage.getItem<ynab.HybridTransactionsResponse>(`transactions`))
	const transationsData =
		cachedTransactions ||
		(await api.transactions.getTransactionsByPayee(BudgetValue.budget, payeeId, getMonth(0)))

	if (!cachedTransactions) {
		await storage.setItem(`transactions`, transationsData)
	}

	const allExistingRolloverTransactions = transationsData.data.transactions

	type TransactionWithCategory = ynab.HybridTransaction & { category_id: string }

	const tbbTransactionsByMonth = reduceByProp(
		`date`,
		allExistingRolloverTransactions.filterAndRemove((t) => t.category_id === tbbCategoryId)
	)
	const byMonth = reduceByProp(
		`month`,
		await Promise.all(
			Array.from({ length: delta + 1 }).map(async (_, i) => {
				const lastMonth = getMonth(i - 1)

				const cachedMonth = debug && (await storage.getItem<ynab.MonthDetailResponse>(lastMonth))
				const budgetMonthData = cachedMonth || (await api.months.getBudgetMonth(BudgetValue.budget, lastMonth))

				if (!cachedMonth) {
					await storage.setItem(lastMonth, budgetMonthData)
				}

				return {
					month: lastMonth,
					categories: budgetMonthData.data.month.categories.filter(
						(c) =>
							!c.deleted &&
							c.original_category_group_id !== paymentsGroupId &&
							c.name !== `To be Budgeted`
					),
					transactions: reduceByProp(`category_id`, allExistingRolloverTransactions.filter(
						(t) => t.date === lastMonth && t.category_id
					) as TransactionWithCategory[])
				}
			})
		)
	)

	interface Values {
		name: string
		balance: number
		existing: number
		adjustment: number
		newBalance: number
	}

	interface Month {
		[categoryId: string]: Values
	}

	interface MonthSet {
		[month: string]: Month
	}

	const monthSets: MonthSet = {}

	for (const [i] of Array.from({ length: delta }).entries()) {
		const previousMonth = getMonth(i - 1)
		const currentMonth = getMonth(i)

		const previousSet: Month = i === 0 ? (monthSets[previousMonth] = {}) : monthSets[previousMonth]
		const currentSet: Month = (monthSets[currentMonth] = {})

		// The first time, we have to first fill in the previous month
		if (i === 0) {
			for (const { id, balance, name } of byMonth[previousMonth]!.categories) {
				previousSet[id] = {
					name,
					balance,
					existing: 0,
					adjustment: 0,
					newBalance: balance
				}
			}
		}

		// Let's calculate values for the current month
		for (const { id, balance, name } of byMonth[currentMonth]!.categories) {
			const { balance: previousBalance, newBalance: previousNewBalance } = previousSet[id]

			const adjustment = previousNewBalance < 0 ? previousNewBalance : 0

			const existing = byMonth[currentMonth]!.transactions[id]
				? byMonth[currentMonth]!.transactions[id]!.amount
				: 0

			const newBalance = existing
				? adjustment === existing
					? balance
					: balance - existing + adjustment
				: previousBalance < 0
				? balance + adjustment
				: balance - previousBalance + previousNewBalance

			currentSet[id] = {
				name,
				balance,
				existing,
				adjustment,
				newBalance
			}
		}
	}

	const update: ynab.UpdateTransaction[] = []
	const create: ynab.SaveTransaction[] = []

	for (const [month, set] of Object.entries(monthSets)) {
		let totalAdjustment = 0

		for (const [categoryId, { adjustment, existing, name }] of Object.entries(set)) {
			totalAdjustment -= adjustment

			if (adjustment === 0 || existing === adjustment) {
				continue
			}

			log(`Adding adjustment for ${name} of ${adjustment / 1000} in ${month}`)

			const transaction = {
				account_id: accountId,
				category_id: categoryId,
				amount: adjustment,
				approved: true,
				cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
				date: month,
				payee_id: payeeId
			}

			const existingAdjustment = byMonth[month]!.transactions[categoryId]

			if (existingAdjustment) {
				update.push({
					id: existingAdjustment.id,
					...transaction
				})
			} else {
				create.push(transaction)
			}
		}

		if (totalAdjustment === 0) {
			continue
		}

		const tbbTransaction = {
			account_id: accountId,
			category_id: tbbCategoryId,
			amount: totalAdjustment,
			approved: true,
			cleared: ynab.UpdateTransaction.ClearedEnum.Cleared,
			date: month,
			payee_id: payeeId
		}

		const tbbExisting = tbbTransactionsByMonth[month]

		if (tbbExisting) {
			if (tbbExisting.amount !== totalAdjustment) {
				update.push({
					id: tbbExisting.id,
					...tbbTransaction
				})
			}
		} else {
			create.push(tbbTransaction)
		}
	}

	const promises: Promise<void>[] = []

	if (create.length > 0) {
		log(`Creating ${create.length} rollover transaction${create.length === 1 ? `` : `s`}.`)

		promises.push(
			api.transactions
				.createTransactions(BudgetValue.budget, {
					transactions: create
				})
				.then(() => log(`Done creating.`))
		)
	}

	if (update.length > 0) {
		log(`Updating ${update.length} rollover transaction${update.length === 1 ? `` : `s`}.`)

		promises.push(
			api.transactions
				.updateTransactions(BudgetValue.budget, {
					transactions: update
				})
				.then(() => log(`Done updating.`))
		)
	}

	if (promises.length > 0) {
		await Promise.all(promises)
	}

	log(`All done.`)
}

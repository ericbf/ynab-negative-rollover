import * as ynab from "ynab"

import { asTuple, error, getMonth, log, reduceByProp } from "../helpers"
import { api, BudgetName, debug, Storage, StorageKey } from "../index"

export async function applyRollovers() {
	const storage = await Storage

	const rolloverAccountId = await storage
		.getItem<string>(StorageKey.account + BudgetName.budget + BudgetName.rolloverAccount)
		.then(async (id) => {
			if (id) {
				return id
			}

			const accounts = await api.accounts.getAccounts(BudgetName.budget)
			const account = accounts.data.accounts.find(
				(a) => a.name === BudgetName.rolloverAccount
			)

			if (!account) {
				throw new Error(
					`Rollover account was not found. Please create an account called "${BudgetName.rolloverAccount}".`
				)
			}

			const value = account.id

			await storage.setItem(StorageKey.account, value)

			return value
		})

	const rolloverPayeeId = await storage
		.getItem<string>(StorageKey.payee + BudgetName.budget + BudgetName.rolloverPayee)
		.then(async (id) => {
			if (id) {
				return id
			}

			const payees = await api.payees.getPayees(BudgetName.budget)
			const payee = payees.data.payees.find((a) => a.name === BudgetName.rolloverPayee)

			if (!payee) {
				throw new Error(
					`Rollover payee was not found. Please create a payee called "${BudgetName.rolloverPayee}"`
				)
			}

			const value = payee.id

			await storage.setItem(StorageKey.payee, value)

			return value
		})

	const [paymentsGroupId, rolloverCategoryId] = await storage
		.getItem<[string | undefined, string]>(
			StorageKey.paymentsGroupAndRolloverCategory +
				BudgetName.budget +
				BudgetName.rolloverCategory
		)
		.then<[string | undefined, string]>(async (ids) => {
			if (ids) {
				return ids
			}

			const groupsData = await api.categories.getCategories(BudgetName.budget)
			const groups = groupsData.data.category_groups

			const group = groups.find((g) => g.name === BudgetName.creditCardPayments)
			const rollover = groups.reduce<ynab.Category | undefined>((trans, next) => {
				if (trans) {
					return trans
				}

				return next.categories.find((c) => c.name === BudgetName.rolloverCategory)
			}, undefined)

			if (!group) {
				log(
					`Didn't find a Credit Card Payments group. Do you not have any credit cards set up? If you do has any credit card accounts set up, please report this.`
				)
			}

			if (!rollover) {
				throw new Error(
					`Rollover category was not found. Please create a budget category called "${BudgetName.rolloverCategory}".`
				)
			}

			const values = asTuple([group && group.id, rollover.id])

			await storage.setItem(StorageKey.paymentsGroupAndRolloverCategory, values)

			return values
		})

	if (!rolloverAccountId || !rolloverPayeeId || !rolloverCategoryId) {
		error(
			`Failed to fetch rollover account (${rolloverAccountId}), rollover payee ${rolloverPayeeId}, or rollover category ID ${rolloverCategoryId}. Please clear the cache.`
		)

		process.exit(-1)
	}

	const startYear = 2019
	const start = new Date(`${startYear}-01-01`)
	const end = new Date()
	const delta =
		end.getFullYear() * 12 +
		end.getMonth() -
		(start.getFullYear() * 12 + start.getMonth())
	const presentMonth = getMonth(0, end.getFullYear(), end.getMonth())

	const cachedTransactions =
		debug && (await storage.getItem<ynab.HybridTransactionsResponse>(`transactions`))
	const transationsData =
		cachedTransactions ||
		(await api.transactions.getTransactionsByPayee(
			BudgetName.budget,
			rolloverPayeeId,
			getMonth(0)
		))

	if (!cachedTransactions) {
		await storage.setItem(`transactions`, transationsData)
	}

	const allExistingRolloverTransactions = transationsData.data.transactions

	type TransactionWithCategory = ynab.HybridTransaction & { category_id: string }

	const rolloverTransactionsByMonth = reduceByProp(
		`date`,
		allExistingRolloverTransactions.filterAndRemove(
			(t) => t.category_id === rolloverCategoryId
		)
	)
	const byMonth = reduceByProp(
		`month`,
		await Promise.all(
			Array.from({ length: delta + 1 }).map(async (_, i) => {
				const lastMonth = getMonth(i - 1)

				const cachedMonth =
					debug && (await storage.getItem<ynab.MonthDetailResponse>(lastMonth))
				const budgetMonthData =
					cachedMonth || (await api.months.getBudgetMonth(BudgetName.budget, lastMonth))

				if (!cachedMonth) {
					await storage.setItem(lastMonth, budgetMonthData)
				}

				return {
					month: lastMonth,
					categories: budgetMonthData.data.month.categories.filter(
						(c) =>
							!c.deleted &&
							c.name !== BudgetName.rolloverCategory &&
							c.category_group_id !== paymentsGroupId &&
							c.original_category_group_id !== paymentsGroupId
					),
					transactions: reduceByProp(
						`category_id`,
						allExistingRolloverTransactions.filter(
							(t) => t.date === lastMonth && t.category_id
						) as TransactionWithCategory[]
					)
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

		const previousSet: Month =
			i === 0 ? (monthSets[previousMonth] = {}) : monthSets[previousMonth]
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
			if (!previousSet[id]) {
				// A category was created, so let's set the initial previous value.
				previousSet[id] = {
					name,
					balance: 0,
					existing: 0,
					adjustment: 0,
					newBalance: 0
				}
			}

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

	const promises: Promise<void>[] = []
	const update: ynab.UpdateTransaction[] = []
	const create: ynab.SaveTransaction[] = []

	for (const [month, set] of Object.entries(monthSets)) {
		let totalAdjustment = 0

		for (const [categoryId, { adjustment, existing, name }] of Object.entries(set)) {
			totalAdjustment -= adjustment

			if (existing === adjustment) {
				continue
			}

			log(`Adding adjustment for ${name} of ${adjustment / 1000} in ${month}`)

			const transaction = {
				account_id: rolloverAccountId,
				category_id: categoryId,
				amount: adjustment,
				approved: true,
				cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
				date: month,
				payee_id: rolloverPayeeId
			}

			const existingAdjustment = byMonth[month]!.transactions[categoryId]

			if (existingAdjustment) {
				update.push({
					id: existingAdjustment.id,
					...transaction
				})
			} else if (adjustment !== 0) {
				create.push(transaction)
			}
		}

		if (presentMonth === month) {
			promises.push(
				api.categories
					.getMonthCategoryById(BudgetName.budget, presentMonth, rolloverCategoryId)
					.then(
						({
							data: {
								category: { balance, budgeted }
							}
						}) => {
							if (balance !== totalAdjustment) {
								return api.categories
									.updateMonthCategory(
										BudgetName.budget,
										presentMonth,
										rolloverCategoryId,
										{
											category: { budgeted: totalAdjustment - balance + budgeted }
										}
									)
									.then(() =>
										log(`Updated ${BudgetName.rolloverCategory} budgeted amount.`)
									)
							}

							return undefined
						}
					)
			)
		}

		const rolloverTransaction = {
			account_id: rolloverAccountId,
			category_id: rolloverCategoryId,
			amount: totalAdjustment,
			approved: true,
			cleared: ynab.UpdateTransaction.ClearedEnum.Cleared,
			date: month,
			payee_id: rolloverPayeeId
		}

		const existingRollover = rolloverTransactionsByMonth[month]

		if (existingRollover) {
			if (existingRollover.amount !== totalAdjustment) {
				update.push({
					id: existingRollover.id,
					...rolloverTransaction
				})
			}
		} else if (totalAdjustment !== 0) {
			create.push(rolloverTransaction)
		}
	}

	if (create.length > 0) {
		log(
			`Creating ${create.length} rollover transaction${create.length === 1 ? `` : `s`}.`
		)

		if (!debug) {
			promises.push(
				api.transactions
					.createTransactions(BudgetName.budget, {
						transactions: create
					})
					.then(() => log(`Done creating.`))
			)
		}
	}

	if (update.length > 0) {
		log(
			`Updating ${update.length} rollover transaction${update.length === 1 ? `` : `s`}.`
		)

		if (!debug) {
			promises.push(
				api.transactions
					.updateTransactions(BudgetName.budget, {
						transactions: update
					})
					.then(() => log(`Done updating.`))
			)
		}
	}

	if (promises.length > 0) {
		await Promise.all(promises)
	}

	log(`All done.`)
}

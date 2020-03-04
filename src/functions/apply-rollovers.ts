import * as ynab from "ynab"

import { error, findMap, getMonth, log, reduceByProp, tuple } from "../helpers"
import { api, debug, Key, Name, Storage } from "../index"

export async function applyRollovers() {
	const storage = await Storage

	const rolloverAccountId = await storage
		.getItem<string>(Key.account)
		.then(async (id) => {
			if (id) {
				return id
			}

			const accounts = await api.accounts.getAccounts(Name.budget)
			const account = accounts.data.accounts.find((a) => a.name === Name.rolloverAccount)

			if (!account) {
				throw new Error(
					`Rollover account was not found. Please create an account called "${Name.rolloverAccount}".`
				)
			}

			const value = account.id

			await storage.setItem(Key.account, value)

			return value
		})

	const rolloverPayeeId = await storage.getItem<string>(Key.payee).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(Name.budget)
		const payee = payees.data.payees.find((a) => a.name === Name.rolloverPayee)

		if (!payee) {
			throw new Error(
				`Rollover payee was not found. Please create a payee called "${Name.rolloverPayee}"`
			)
		}

		const value = payee.id

		await storage.setItem(Key.payee, value)

		return value
	})

	const [paymentsGroupId, rolloverCategoryId, inflowsCategoryId] = await storage
		.getItem(Key.paymentsOutsideRolloverAndInflows)
		.then(async (ids) => {
			if (ids) {
				return ids as typeof values
			}

			const groupsData = await api.categories.getCategories(Name.budget)
			const groups = groupsData.data.category_groups

			const payments = groups.find((g) => g.name === Name.creditCardPayments)

			const rollover = findMap(groups, (group) =>
				group.categories.find((category) => category.name === Name.rolloverCategory)
			)

			const inflows = findMap(groups, (group) =>
				group.categories.find((category) => category.name === Name.inflowsCategory)
			)

			if (!payments) {
				log(
					`Didn't find a Credit Card Payments group. Do you not have any credit cards set up? If you do have any credit card accounts set up, please report this.`
				)
			}

			if (!rollover) {
				throw new Error(
					`Rollover category was not found. Please create a budget category called "${Name.rolloverCategory}".`
				)
			}

			if (!inflows) {
				throw new Error(`Inflows category was not found. Please report this.`)
			}

			const values = tuple(payments?.id, rollover.id, inflows.id)

			await storage.setItem(Key.paymentsOutsideRolloverAndInflows, values)

			return values
		})

	if (
		!rolloverAccountId ||
		!rolloverPayeeId ||
		!rolloverCategoryId ||
		!inflowsCategoryId
	) {
		error(
			`Failed to fetch rollover account (${rolloverAccountId}), rollover payee (${rolloverPayeeId}), rollover category ID (${rolloverCategoryId}), or inflows category ID (${inflowsCategoryId}). Please clear the cache.`
		)

		process.exit(-1)
	}

	const startYear = 2019
	const start = new Date(`${startYear}-01-01`)
	const end = new Date()
	const numberMonthsSinceStart =
		end.getFullYear() * 12 +
		end.getMonth() -
		(start.getFullYear() * 12 + start.getMonth())
	const currentMonth = getMonth(numberMonthsSinceStart - 1)
	const previousMonth = getMonth(numberMonthsSinceStart - 2)

	const cachedTransactions =
		debug && (await storage.getItem<ynab.HybridTransactionsResponse>(`transactions`))
	const transationsData =
		cachedTransactions ||
		(await api.transactions.getTransactionsByPayee(
			Name.budget,
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
			Array.from({ length: numberMonthsSinceStart + 1 }).map(async (_, i) => {
				const lastMonth = getMonth(i - 1)

				const cachedMonth =
					debug && (await storage.getItem<ynab.MonthDetailResponse>(lastMonth))
				const budgetMonthData =
					cachedMonth || (await api.months.getBudgetMonth(Name.budget, lastMonth))

				if (!cachedMonth) {
					await storage.setItem(lastMonth, budgetMonthData)
				}

				return {
					month: lastMonth,
					categories: budgetMonthData.data.month.categories.filter(
						(c) =>
							!c.deleted &&
							c.id !== rolloverCategoryId &&
							c.id !== inflowsCategoryId &&
							c.category_group_id !== paymentsGroupId &&
							c.original_category_group_id !== paymentsGroupId
					),
					toBeBudgeted: budgetMonthData.data.month.to_be_budgeted,
					budgeted: budgetMonthData.data.month.budgeted,
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

	for (const [i] of Array.from({ length: numberMonthsSinceStart }).entries()) {
		const lastMonth = getMonth(i - 1)
		const thisMonth = getMonth(i)

		const previousSet = monthSets[lastMonth] || (monthSets[lastMonth] = {})
		const currentSet: Month = (monthSets[thisMonth] = {})

		// The first time, we have to first fill in the previous month
		if (i === 0) {
			for (const { id, balance, name } of byMonth[lastMonth]!.categories) {
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
		for (const { id, balance, name } of byMonth[thisMonth]!.categories) {
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

			const existing = byMonth[thisMonth]!.transactions[id]
				? byMonth[thisMonth]!.transactions[id]!.amount
				: 0

			const newBalance = existing
				? balance - existing + adjustment
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
	let onDone: (() => Promise<void>) | undefined
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

		if (month === currentMonth) {
			onDone = async () =>
				api.categories
					.getMonthCategoryById(Name.budget, currentMonth, rolloverCategoryId)
					.then(
						async ({
							data: {
								category: { balance, budgeted }
							}
						}) => {
							const thisMonth = byMonth[currentMonth]!
							const lastMonth = byMonth[previousMonth]!
							const rollover = balance - budgeted
							const baseBudgeted = totalAdjustment - rollover

							const offset =
								thisMonth.toBeBudgeted -
								lastMonth.toBeBudgeted +
								thisMonth.budgeted -
								baseBudgeted

							if (balance !== totalAdjustment + offset) {
								await api.categories
									.updateMonthCategory(Name.budget, currentMonth, rolloverCategoryId, {
										category: {
											budgeted: totalAdjustment - rollover + offset
										}
									})
									.then(() => log(`Updated ${Name.rolloverCategory} budgeted amount.`))
							}
						}
					)
		}
	}

	if (create.length > 0) {
		log(
			`Creating ${create.length} rollover transaction${create.length === 1 ? `` : `s`}.`
		)

		if (!debug) {
			promises.push(
				api.transactions
					.createTransactions(Name.budget, {
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
					.updateTransactions(Name.budget, {
						transactions: update
					})
					.then(() => log(`Done updating.`))
			)
		}
	}

	await Promise.all(promises)
	await onDone?.()

	log(`All done.`)
}

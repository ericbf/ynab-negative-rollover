import * as ynab from "ynab"

import { areEqual, error, formatMoney, log, Tuple } from "../helpers"
import { api, debug, Key, Name, Storage } from "../index"

export async function applyRollovers() {
	const storage = await Storage

	const rolloverAccountId = await storage
		.getItem<string>(Key.rolloverAccountId)
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

			await storage.setItem(Key.rolloverAccountId, value)

			return value
		})

	const rolloverPayeeId = await storage
		.getItem<string>(Key.rolloverPayeeId)
		.then(async (id) => {
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

			await storage.setItem(Key.rolloverPayeeId, value)

			return value
		})

	const [
		paymentsGroupId,
		rolloverCategoryId,
		inflowsCategoryId,
		offsetGroupIds
	] = await storage.getItem(Key.paymentsRolloverAndInflowsGroupIds).then(async (ids) => {
		if (ids) {
			return ids as typeof values
		}

		const groupsData = await api.categories.getCategories(Name.budget)
		const groups = groupsData.data.category_groups

		const paymentsGroupId = groups.find((g) => g.name === Name.creditCardPayments)

		const rollover = groups.mappedFind(({ categories }) =>
			categories.find((category) => category.name === Name.rolloverCategory)
		)

		const inflows = groups.mappedFind(({ categories }) =>
			categories.find((category) => category.name === Name.inflowsCategory)
		)

		const offsetGroupIds = groups
			.filter((g) => Name.groupsToOffset.includes(g.name))
			.map(({ id }) => id)

		if (!paymentsGroupId) {
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

		const values = Tuple(paymentsGroupId?.id, rollover.id, inflows.id, offsetGroupIds)

		await storage.setItem(Key.paymentsRolloverAndInflowsGroupIds, values)

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

	const now = new Date()
	const currentYear = now.getFullYear()
	const nextMonth = `0${now.getMonth() + 2}`.slice(-2)
	const upperLimit = `${currentYear}-${nextMonth}`
	const nextMonthString = `${upperLimit}-01`

	const {
		data: { months: changedMonths, server_knowledge: monthsKnowledge }
	} = await api.months.getBudgetMonths(
		Name.budget,
		await storage.getItem(Key.monthsKnowledge)
	)

	const months = (await storage.getItem<ynab.MonthDetail[]>(Key.monthsData)) ?? []

	if (changedMonths.length) {
		await Promise.all(
			changedMonths.map(async ({ month, deleted }) => {
				if (deleted) {
					months.findAndRemove(({ month: existing }) => month === existing)
				} else {
					const existing = months.find(
						({ month: existingMonth }) => month === existingMonth
					)
					const {
						data: { month: updated }
					} = await api.months.getBudgetMonth(Name.budget, month)

					if (existing) {
						Object.assign(existing, updated)
					} else {
						months.push(updated)
					}
				}
			})
		)

		months.sortBy(`month`).removeMatching((month) => {
			return (
				month.month > nextMonthString ||
				areEqual(0, month.activity, month.budgeted, month.income, month.to_be_budgeted)
			)
		})

		await storage.setItem(Key.monthsData, months)
		await storage.setItem(Key.monthsKnowledge, monthsKnowledge)
	}

	const {
		data: {
			transactions: changedRolloverTransactions,
			// @ts-ignore
			server_knowledge: rolloverTransactionsKnowledge
		}
	} = await api.transactions.getTransactionsByPayee(
		Name.budget,
		rolloverPayeeId,
		undefined,
		undefined,
		await storage.getItem(Key.rolloverTransactionsKnowledge)
	)

	const rolloverTransactions =
		(await storage.getItem<ynab.HybridTransaction[]>(Key.rolloverTransactionsData)) ?? []

	if (changedRolloverTransactions.length > 0) {
		for (const updated of changedRolloverTransactions) {
			if (updated.deleted) {
				rolloverTransactions.findAndRemove(({ id }) => id === updated.id)
			} else {
				const existing = rolloverTransactions.find(({ id }) => id === updated.id)

				if (existing) {
					Object.assign(existing, updated)
				} else {
					rolloverTransactions.push(updated)
				}
			}
		}

		await storage.setItem(Key.rolloverTransactionsData, rolloverTransactions)
		await storage.setItem(
			Key.rolloverTransactionsKnowledge,
			rolloverTransactionsKnowledge
		)
	}

	const rolloverByDateThenCategory = Object.map(
		rolloverTransactions.groupBy(`date`),
		(_, v) => v?.indexBy(`category_id`)
	)

	const categoriesById = months.map((m) => m.categories.indexBy(`id`))

	const promises: Promise<void>[] = []
	const update: ynab.UpdateTransaction[] = []
	const create: ynab.SaveTransaction[] = []

	for (let i = 0; i < months.length; i += 1) {
		const month = months[i]

		if (month.month >= nextMonthString) {
			continue
		}

		let rolloverTransactionOffsetAmount = 0
		let unbudgetedSpenditureBalance = 0

		for (const category of month.categories) {
			if (
				[inflowsCategoryId, rolloverCategoryId].includes(category.id) ||
				[category.category_group_id, category.original_category_group_id].includes(
					paymentsGroupId
				)
			) {
				continue
			}

			const existing = rolloverByDateThenCategory[month.month]?.[category.id]
			const balanceFromLastMonth = Math.min(
				categoriesById[i - 1]?.[category.id]?.balance ?? 0,
				0
			)
			const needsUpdate = balanceFromLastMonth !== (existing?.amount ?? 0)

			rolloverTransactionOffsetAmount -= balanceFromLastMonth

			if (
				offsetGroupIds.includes(category.category_group_id) ||
				offsetGroupIds.includes(category.original_category_group_id)
			) {
				unbudgetedSpenditureBalance -= category.balance
			}

			if (needsUpdate) {
				const verb = existing ? `Updating` : `Adding`
				const preposition = existing
					? `from ${formatMoney(existing.amount / 1000)} to`
					: `of`

				log(
					`${verb} adjustment for ${category.name} ${preposition} ${formatMoney(
						balanceFromLastMonth / 1000
					)} in ${month.month}`
				)

				const transaction = {
					account_id: rolloverAccountId,
					category_id: category.id,
					amount: balanceFromLastMonth,
					approved: true,
					cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
					date: month.month,
					payee_id: rolloverPayeeId
				}

				let impactFromLastMonth = balanceFromLastMonth

				for (let j = i; j < months.length; j += 1) {
					if (impactFromLastMonth === 0) {
						break
					}

					const thisMonth = categoriesById[j][category.id]!
					const thisMonthBeforeChange = Math.max(thisMonth.balance, 0)

					thisMonth.balance += impactFromLastMonth

					impactFromLastMonth = Math.max(-thisMonthBeforeChange, impactFromLastMonth)
				}

				if (existing) {
					category.balance -= existing.amount

					update.push({
						id: existing.id,
						...transaction
					})
				} else {
					create.push(transaction)
				}
			}
		}

		const existingRollover = rolloverByDateThenCategory[month.month]?.[rolloverCategoryId]

		const rolloverCategory = categoriesById[i][rolloverCategoryId]!
		const transactionNeedsUpdate =
			rolloverTransactionOffsetAmount !== (existingRollover?.amount ?? 0)
		const balanceNeedsUpdate =
			transactionNeedsUpdate ||
			unbudgetedSpenditureBalance !== categoriesById[i][rolloverCategoryId]!.balance

		if (transactionNeedsUpdate) {
			const rolloverTransaction = {
				account_id: rolloverAccountId,
				category_id: rolloverCategoryId,
				amount: rolloverTransactionOffsetAmount,
				approved: true,
				cleared: ynab.UpdateTransaction.ClearedEnum.Cleared,
				date: month.month,
				payee_id: rolloverPayeeId
			}
			const verb = existingRollover ? `Updating` : `Adding`
			const preposition = existingRollover
				? `from ${formatMoney(existingRollover.amount / 1000)} to`
				: `of`

			log(
				`${verb} rollover offset ${preposition} ${formatMoney(
					rolloverTransactionOffsetAmount / 1000
				)} in ${month.month}`
			)

			if (existingRollover) {
				rolloverCategory.balance -= existingRollover.amount + rolloverTransaction.amount

				update.push({
					id: existingRollover.id,
					...rolloverTransaction
				})
			} else {
				rolloverCategory.balance += rolloverTransaction.amount

				create.push(rolloverTransaction)
			}
		}

		if (balanceNeedsUpdate) {
			const desiredBudgeted =
				unbudgetedSpenditureBalance -
				(rolloverCategory.balance - rolloverCategory.budgeted)

			let impactFromLastMonth = unbudgetedSpenditureBalance - rolloverCategory.balance

			for (let j = i; j < months.length; j += 1) {
				if (impactFromLastMonth === 0) {
					break
				}

				const thisMonth = categoriesById[j][rolloverCategoryId]!
				const thisMonthBeforeChange = Math.max(thisMonth.balance, 0)

				thisMonth.balance += impactFromLastMonth

				impactFromLastMonth = Math.max(-thisMonthBeforeChange, impactFromLastMonth)
			}

			log(
				`Updating budgeted amount in rollover offset category to ${formatMoney(
					desiredBudgeted / 1000
				)} in ${month.month}`
			)

			if (!debug) {
				promises.push(
					api.categories
						.updateMonthCategory(Name.budget, month.month, rolloverCategoryId, {
							category: {
								budgeted: desiredBudgeted
							}
						})
						.then()
				)
			}
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

	log(`All done.`)
}

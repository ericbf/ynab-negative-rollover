import {
	HybridTransaction,
	MonthDetail,
	PatchTransactionsWrapper,
	PostTransactionsWrapper,
	TransactionClearedStatus
} from "ynab"

import areEqual from "fast-ts-helpers/areEqual"
import tuple from "fast-ts-helpers/tuple"

import { api, debug, Key, env, Storage } from "../index"
import { error, log } from "../helpers/console"
import formatMoney from "../helpers/functions"

/** Apply the rollover transactions and offsets.  */
export default async function apply() {
	// * Get the cached IDs
	const storage = await Storage

	const rolloverAccountId = await storage
		.getItem<string>(Key.rolloverAccountId)
		.then(async (id) => {
			if (id) {
				return id
			}

			const accounts = await api.accounts.getAccounts(env.budget)
			const account = accounts.data.accounts.find((a) => a.name === env.rolloverAccount)

			if (!account) {
				throw new Error(
					`Rollover account was not found. Please create an account called "${env.rolloverAccount}".`
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

			const payees = await api.payees.getPayees(env.budget)
			const payee = payees.data.payees.find((a) => a.name === env.rolloverPayee)

			if (!payee) {
				throw new Error(
					`Rollover payee was not found. Please create a payee called "${env.rolloverPayee}"`
				)
			}

			const value = payee.id

			await storage.setItem(Key.rolloverPayeeId, value)

			return value
		})

	const [paymentsGroupId, rolloverCategoryId, inflowsCategoryId, offsetGroupIds] =
		await storage
			.getItem(Key.paymentsRolloverAndInflowsGroupIds)
			.then<[string | undefined, string, string, string, string[]]>(async (ids) => {
				if (ids) {
					return ids
				}

				const groupsData = await api.categories.getCategories(env.budget)
				const groups = groupsData.data.category_groups

				const paymentsGroup = groups.find((g) => g.name === env.creditCardPayments)

				if (!paymentsGroup) {
					log(
						`Didn’t find a Credit Card Payments group. If you have credit card accounts set up and see this, please report this.`
					)
				}

				const rollover = groups.mappedFind(({ categories }) =>
					categories.find((category) => category.name === env.rolloverCategory)
				)

				if (!rollover) {
					throw new Error(
						`Rollover category was not found. Please create a budget category called "${env.rolloverCategory}".`
					)
				}

				const inflows = groups.mappedFind(({ categories }) =>
					categories.find((category) => category.name === env.inflowsCategory)
				)

				if (!inflows) {
					throw new Error(`Inflows category was not found. Please report this.`)
				}

				const offsetGroups = groups.filter((g) => env.groupsToOffset.includes(g.name))

				const values = tuple(
					paymentsGroup?.id,
					rollover.id,
					inflows.id,
					offsetGroups.map(({ id }) => id)
				)

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
			`Failed to fetch rollover account (${rolloverAccountId}),`,
			`rollover payee (${rolloverPayeeId}),`,
			`rollover category ID (${rolloverCategoryId}),`,
			`or inflows category ID (${inflowsCategoryId}).`,
			`Please clear the cache.`
		)

		process.exit(-1)
	}

	const now = new Date()
	const currentMonthPadded = `0${now.getMonth() + 1}`.slice(-2)
	const currentMonth = `${now.getFullYear()}-${currentMonthPadded}-01`

	const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
	const nextMonthPadded = `0${nextMonthDate.getMonth() + 1}`.slice(-2)
	const nextMonth = `${nextMonthDate.getFullYear()}-${nextMonthPadded}-01`

	// * Find changes since last run

	const {
		data: { months: changedMonths, server_knowledge: monthsKnowledge }
	} = await api.months.getBudgetMonths(
		env.budget,
		await storage.getItem(Key.monthsKnowledge)
	)

	const months = (await storage.getItem<MonthDetail[]>(Key.monthsData)) ?? []

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
					} = await api.months.getBudgetMonth(env.budget, month)

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
				month.month > nextMonth ||
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
		env.budget,
		rolloverPayeeId,
		undefined,
		undefined,
		await storage.getItem(Key.rolloverTransactionsKnowledge)
	)

	const rolloverTransactions =
		(await storage.getItem<HybridTransaction[]>(Key.rolloverTransactionsData)) ?? []

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

	const categoryMaps = months.map((m) => m.categories.indexBy(`id`))

	const promises: Promise<any>[] = []
	const update: PatchTransactionsWrapper["transactions"] = []
	const create: PostTransactionsWrapper["transactions"] = []

	for (const [i, month] of months.entries()) {
		/** The categories for the month currently being processed, by ID. */
		const categoryMap = categoryMaps[i]!

		/**
		 * The amount to be offset in the single offset rollover transaction amount (a positive transaction of the same magnitude as the sum of the negative rollover transactions, such that the total amount available is not changed).
		 */
		let rolloverTransactionOffsetAmount = 0
		/**
		 * The amount that needs to be offset from the unbudgeted categories.
		 */
		let totalUnbudgetedAmount = 0

		/**
		 * The categories for the month before the one currently being processed, by ID.
		 */
		const lastMonthsCategories = categoryMaps[i - 1]

		for (const category of month.categories) {
			/**
			 * The amount that YNAB rolled over from the previous month.
			 *
			 * * YNAB rolls over only positive balances, so that's what we capture here.
			 */
			const balanceFromLastMonth = Math.min(
				lastMonthsCategories?.[category.id]?.balance ?? 0,
				0
			)

			// * Let's not process transactions from inflows or calculation categories
			if (
				[inflowsCategoryId, rolloverCategoryId].includes(category.id) ||
				[category.category_group_id, category.original_category_group_id].includes(
					paymentsGroupId
				)
			) {
				continue
			}

			// * For months before or equal to the current month
			if (month.month <= currentMonth) {
				/** The existing rollover transaction for the month being processed. */
				const existing = rolloverByDateThenCategory[month.month]?.[category.id]
				/**
				 * Balance from the last month does not equal the existing rollover transaction's amount, or if no such existing transaction exists, it is not non-zero.
				 */
				const needsUpdate = balanceFromLastMonth !== (existing?.amount ?? 0)

				// * We keep the total offset up to date. If we rolled over a positive balance in a category, we have to account for that in the total offset amount.
				rolloverTransactionOffsetAmount -= balanceFromLastMonth

				if (needsUpdate) {
					// * Some deduplication of the log strings.
					const [verb, preposition] = existing
						? [`Updating`, `by ${formatMoney(existing.amount - balanceFromLastMonth)} to`]
						: [`Adding`, `of`]

					log(
						`${verb} adjustment for ${category.name} ${preposition} ${formatMoney(
							balanceFromLastMonth
						)} in ${month.month}`
					)

					const transaction = {
						account_id: rolloverAccountId,
						category_id: category.id,
						amount: balanceFromLastMonth,
						approved: true,
						cleared: TransactionClearedStatus.Cleared,
						date: month.month,
						payee_id: rolloverPayeeId
					}

					if (existing) {
						adjustBalance(category.id, i, balanceFromLastMonth - existing.amount)

						update.push({
							id: existing.id,
							...transaction
						})
					} else {
						adjustBalance(category.id, i, balanceFromLastMonth)

						create.push(transaction)
					}
				}
			}

			if (
				[category.category_group_id, category.original_category_group_id!].some((id) =>
					offsetGroupIds.includes(id)
				)
			) {
				// Category is inside the offset groups
				if (month.month <= currentMonth) {
					if (category.balance < 0) {
						totalUnbudgetedAmount -= category.balance
					}
				}
			}
		}

		if (month.month <= currentMonth) {
			const existingRollover =
				rolloverByDateThenCategory[month.month]?.[rolloverCategoryId]

			const transactionNeedsUpdate =
				rolloverTransactionOffsetAmount !== (existingRollover?.amount ?? 0)
			const balanceNeedsUpdate =
				transactionNeedsUpdate ||
				totalUnbudgetedAmount !== categoryMap[rolloverCategoryId]?.balance

			if (transactionNeedsUpdate) {
				const rolloverTransaction = {
					account_id: rolloverAccountId,
					category_id: rolloverCategoryId,
					amount: rolloverTransactionOffsetAmount,
					approved: true,
					cleared: TransactionClearedStatus.Cleared,
					date: month.month,
					payee_id: rolloverPayeeId
				}
				const verb = existingRollover ? `Updating` : `Adding`
				const preposition = existingRollover
					? `by ${formatMoney(
							existingRollover.amount - rolloverTransactionOffsetAmount
						)} to`
					: `of`

				log(
					`${verb} rollover offset transaction ${preposition} ${formatMoney(
						rolloverTransactionOffsetAmount
					)} in ${month.month}`
				)

				if (existingRollover) {
					adjustBalance(
						rolloverCategoryId,
						i,
						rolloverTransaction.amount - existingRollover.amount
					)

					update.push({
						id: existingRollover.id,
						...rolloverTransaction
					})
				} else {
					adjustBalance(rolloverCategoryId, i, rolloverTransaction.amount)

					create.push(rolloverTransaction)
				}
			}

			if (balanceNeedsUpdate) {
				const { id, balance, budgeted } = categoryMap?.[rolloverCategoryId]!
				const desiredBudgeted = totalUnbudgetedAmount - (balance - budgeted)

				const delta = desiredBudgeted - budgeted

				log(
					`Updating rollover offset budgeted in ${month.month} by ${formatMoney(
						delta
					)} (from ${formatMoney(budgeted)} to ${formatMoney(
						desiredBudgeted
					)} for a balance of ${formatMoney(totalUnbudgetedAmount)})`
				)

				adjustBalance(id, i, delta)

				if (!debug) {
					promises.push(
						api.categories.updateMonthCategory(env.budget, month.month, id, {
							category: {
								budgeted: desiredBudgeted
							}
						})
					)
				}
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
					.createTransactions(env.budget, {
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
					.updateTransactions(env.budget, {
						transactions: update
					})
					.then(() => log(`Done updating.`))
			)
		}
	}

	await Promise.all(promises)

	log(`All done.`)

	function adjustBalance(category: string, inMonth: number, byAmount: number) {
		if (byAmount === 0 || inMonth >= months.length) {
			return
		}

		const month = categoryMaps[inMonth]?.[category]

		if (!month) {
			return
		}

		let impactToNextMonth =
			month.balance > 0
				? Math.max(byAmount, -month.balance)
				: Math.max(0, month.balance + byAmount)

		month.balance += byAmount

		adjustBalance(category, inMonth + 1, impactToNextMonth)
	}
}

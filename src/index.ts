import "./globals"

import { readFileSync } from "fs"
import storage from "node-persist"
import * as ynab from "ynab"

import { error, log } from "./helpers"

// This is the access token if we need it.
export let token = process.env.TOKEN! && process.env.TOKEN!.trim()

if (!token) {
	try {
		const data = readFileSync(__filename.replace(/\.[^\.]+$/, `.token`))

		token = data.toString().trim()
	} catch {}

	if (!token) {
		error(`No access token passed in ENV or token file. We won't be able talk with the API.`)

		process.exit(-1)
	}
}

export async function run() {
	const budget = `last-used`
	const api = new ynab.API(token)

	await storage.init({
		dir: __dirname
	})

	const accountId = await storage.getItem<string>(`account`).then(async (id) => {
		if (id) {
			return id
		}

		const accounts = await api.accounts.getAccounts(budget)
		const account = accounts.data.accounts.find((a) => a.type === ynab.Account.TypeEnum.Cash)

		if (!account) {
			throw new Error(`No cash account found.`)
		}

		await storage.setItem(`account`, account.id)

		return account.id
	})

	const payeeId = await storage.getItem<string>(`payee`).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(budget)
		const payee = payees.data.payees.find((a) => a.name === `Budget Rollover`)

		if (!payee) {
			throw new Error(`No rollover payee found.`)
		}

		await storage.setItem(`payee`, payee.id)

		return payee.id
	})

	const paymentsGroupId = await storage.getItem<string>(`paymentsGroup`).then(async (id) => {
		if (id) {
			return id
		}

		const groups = await api.categories.getCategories(budget)
		const group = groups.data.category_groups.find((g) => g.name === `Credit Card Payments`)

		if (!group) {
			throw new Error(`No payments account group found.`)
		}

		await storage.setItem(`paymentsGroup`, group.id)

		return group.id
	})

	if (!accountId || !payeeId || !paymentsGroupId) {
		error(
			`Failed to get account (${accountId}), payee ${payeeId}, or payments group ${paymentsGroupId}`
		)

		process.exit(-1)
	}

	const startYear = 2019
	const start = new Date(`${startYear}-01-01`)
	const end = new Date()
	const delta =
		end.getFullYear() * 12 + end.getMonth() - (start.getFullYear() * 12 + start.getMonth())

	const getMonth = (month: number) => {
		return new Date(startYear, month, 1).toISOString().substring(0, 10)
	}

	const transationsData = await api.transactions.getTransactionsByPayee(
		budget,
		payeeId,
		getMonth(0)
	)

	const allExistingRolloverTransactions = transationsData.data.transactions.filter(
		(t) => t.account_id === accountId
	)

	for (let month = 0; month < delta; month += 1) {
		const lastMonth = getMonth(month - 1)
		const thisMonth = getMonth(month)
		const budgetMonthData = await api.months.getBudgetMonth(budget, lastMonth)

		const allCategories = budgetMonthData.data.month.categories
		const categories = allCategories.filter(
			(c) => c.balance < 0 && !c.deleted && c.original_category_group_id !== paymentsGroupId
		)
		const toBeBudgeted = allCategories.find((c) => c.name === `To be Budgeted`)!
		const totalAmount = categories.reduce((s, n) => s - n.balance, 0)

		const rolloverTransactions = allExistingRolloverTransactions
			.filter((t) => t.date === thisMonth && t.category_id !== toBeBudgeted.id)
			.map((transaction) => {
				const category = categories.find((c) => c.id === transaction.category_id)

				if (!category) {
					error(
						`Please delete transaction in ${transaction.category_name} for ${transaction.amount} on ${thisMonth}.`
					)
				}

				return { transaction, category: category! }
			})
			.filter(({ category }) => category)
		const toBeBudgetedTransaction = allExistingRolloverTransactions.find(
			(t) => t.date === thisMonth && t.category_id === toBeBudgeted.id
		)

		const needsToBeCreated = categories.filter(
			(c) => !rolloverTransactions.find(({ category }) => category.id === c.id)
		)
		const needsToBeUpdated = rolloverTransactions.filter(({ category, transaction }) => {
			return transaction.amount !== category.balance
		})

		const createTransactionsWrapper = {
			transactions: needsToBeCreated.map(
				({ balance: amount, id: categoryId }): ynab.SaveTransaction => ({
					account_id: accountId,
					category_id: categoryId,
					amount,
					approved: true,
					cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
					date: thisMonth,
					payee_id: payeeId
				})
			)
		}

		const updateTransactionsWrapper = {
			transactions: needsToBeUpdated.map(
				({
					category: { id: categoryId, balance: amount },
					transaction: { id }
				}): ynab.UpdateTransaction => ({
					id,
					account_id: accountId,
					category_id: categoryId,
					amount,
					approved: true,
					cleared: ynab.UpdateTransaction.ClearedEnum.Cleared,
					date: thisMonth,
					payee_id: payeeId
				})
			)
		}

		if (!toBeBudgetedTransaction) {
			createTransactionsWrapper.transactions.push({
				account_id: accountId,
				category_id: toBeBudgeted.id,
				amount: totalAmount,
				approved: true,
				cleared: ynab.UpdateTransaction.ClearedEnum.Cleared,
				date: thisMonth,
				payee_id: payeeId
			})
		} else if (toBeBudgetedTransaction.amount !== totalAmount) {
			updateTransactionsWrapper.transactions.push({
				id: toBeBudgetedTransaction.id,
				account_id: accountId,
				category_id: toBeBudgeted.id,
				amount: totalAmount,
				approved: true,
				cleared: ynab.SaveTransaction.ClearedEnum.Cleared,
				date: thisMonth,
				payee_id: payeeId
			})
		}

		const promises: Promise<void>[] = []

		const createCount = createTransactionsWrapper.transactions.length

		if (createCount > 0) {
			log(
				`Creating ${createCount} rollover transaction${
					createCount === 1 ? `` : `s`
				} in ${thisMonth}.`
			)

			promises.push(
				api.transactions
					.createTransactions(budget, createTransactionsWrapper)
					.then(() => log(`Done creating.`))
			)
		}

		const updateCount = updateTransactionsWrapper.transactions.length

		if (updateCount > 0) {
			log(
				`Updating ${updateCount} rollover transaction${
					updateCount === 1 ? `` : `s`
				} in  in ${thisMonth}.`
			)

			promises.push(
				api.transactions
					.updateTransactions(budget, updateTransactionsWrapper)
					.then(() => log(`Done updating.`))
			)
		}

		if (promises.length > 0) {
			await Promise.all(promises)
		}
	}

	log(`All done.`)
}

module.exports = run().catch((e) => error(`Some error! ${e.message || JSON.stringify(e)}`))

import {
	PatchTransactionsWrapper,
	PostTransactionsWrapper,
	TransactionClearedStatus
} from "ynab"

import { api, env } from "../index"

/** Apply the rollover transactions and offsets.  */
export default async function marketValue() {
	const accounts = await api.accounts.getAccounts(env.budget)

	const toCreate: PostTransactionsWrapper = { transactions: [] }
	const toUpdate: PatchTransactionsWrapper = { transactions: [] }

	for (const account of accounts.data.accounts) {
		if (!account.note) {
			continue
		}

		let parts = account.note.match(/^Balance: (-?[0-9]+(?:\.[0-9]+)?) (.+)$/)

		if (!parts || !parts[1] || !parts[2]) {
			continue
		}

		const balance = parseFloat(parts[1])
		const currency = parts[2]

		// TODO: support other base currencies
		const costResponse = (await fetch(
			`https://min-api.cryptocompare.com/data/price?fsym=${currency}&tsyms=USD`
		).then((r) => r.json())) as { USD: string }

		const cost = parseFloat(costResponse.USD)
		const currentValue = Math.round(balance * cost * 1000)

		const now = new Date()
		const date = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`

		if (account.balance != currentValue) {
			const transactionsRequest = await api.transactions.getTransactionsByAccount(
				env.budget,
				account.id,
				date
			)

			const existing = transactionsRequest.data.transactions.find(
				(transaction) => transaction.payee_name === "Market Change"
			)

			const transaction = {
				account_id: account.id,
				amount: currentValue - account.balance,
				date,
				cleared: TransactionClearedStatus.Cleared,
				approved: true,
				payee_name: "Market Change",
				memo: `Current cost: ${cost} USD\nCurrent balance: ${balance} ${currency}`
			}

			if (existing) {
				toUpdate.transactions.push({
					...transaction,
					id: existing.id,
					amount: transaction.amount + existing.amount
				})
			} else {
				toCreate.transactions?.push(transaction)
			}
		}
	}

	return Promise.all([
		toCreate.transactions?.length &&
			api.transactions.createTransactions(env.budget, toCreate),
		toUpdate.transactions.length &&
			api.transactions.updateTransactions(env.budget, toUpdate)
	])
}

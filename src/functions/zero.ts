import * as ynab from "ynab"

import { api, debug, Key, env, Storage } from "../index"

/** Zero out all the rollover transactions */
export default async function zero() {
	const storage = await Storage

	const payeeId = await storage.getItem<string>(Key.rolloverPayeeId).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(env.budget)
		const payee = payees.data.payees.find((a) => a.name === env.rolloverPayee)

		if (!payee) {
			throw new Error(`No rollover payee found.`)
		}

		await storage.setItem(Key.rolloverPayeeId, payee.id)

		return payee.id
	})

	const cachedTransactions =
		debug && (await storage.getItem<ynab.HybridTransactionsResponse>(`transactions`))
	const transationsData =
		cachedTransactions ||
		(await api.transactions.getTransactionsByPayee(env.budget, payeeId))

	if (!cachedTransactions) {
		await storage.setItem(`transactions`, transationsData)
	}

	const allExistingRolloverTransactions = transationsData.data.transactions

	return api.transactions.updateTransactions(env.budget, {
		transactions: allExistingRolloverTransactions.map((t) => ({
			...t,
			amount: 0
		}))
	})
}

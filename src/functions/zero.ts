import * as ynab from "ynab"

import { api, debug, Key, Name, Storage } from "../index"

/** Zero out all the rollover transactions */
export async function zero() {
	const storage = await Storage

	const payeeId = await storage.getItem<string>(Key.rolloverPayeeId).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(Name.budget)
		const payee = payees.data.payees.find((a) => a.name === Name.rolloverPayee)

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
		(await api.transactions.getTransactionsByPayee(Name.budget, payeeId))

	if (!cachedTransactions) {
		await storage.setItem(`transactions`, transationsData)
	}

	const allExistingRolloverTransactions = transationsData.data.transactions

	return api.transactions.updateTransactions(Name.budget, {
		transactions: allExistingRolloverTransactions.map((t) => ({
			...t,
			amount: 0
		}))
	})
}

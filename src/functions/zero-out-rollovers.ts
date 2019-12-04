import * as ynab from "ynab"

import { getMonth } from "../helpers"
import { api, BudgetName, debug, Storage, StorageKey } from "../index"

export async function zeroOutRollovers() {
	const storage = await Storage

	const payeeId = await storage.getItem<string>(StorageKey.payee).then(async (id) => {
		if (id) {
			return id
		}

		const payees = await api.payees.getPayees(BudgetName.budget)
		const payee = payees.data.payees.find((a) => a.name === BudgetName.rolloverPayee)

		if (!payee) {
			throw new Error(`No rollover payee found.`)
		}

		await storage.setItem(StorageKey.payee, payee.id)

		return payee.id
	})

	const cachedTransactions =
		debug && (await storage.getItem<ynab.HybridTransactionsResponse>(`transactions`))
	const transationsData =
		cachedTransactions ||
		(await api.transactions.getTransactionsByPayee(
			BudgetName.budget,
			payeeId,
			getMonth(0)
		))

	if (!cachedTransactions) {
		await storage.setItem(`transactions`, transationsData)
	}

	const allExistingRolloverTransactions = transationsData.data.transactions

	return api.transactions.updateTransactions(BudgetName.budget, {
		transactions: allExistingRolloverTransactions.map((t) => ({
			...t,
			amount: 0
		}))
	})
}

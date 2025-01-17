import "./globals"

import cron from "node-cron"
import storage from "node-persist"
import path from "path"
import * as ynab from "ynab"

import { error } from "./helpers/console"
import prompt from "./helpers/prompt"
import apply from "./functions/apply"
import zero from "./functions/zero"
import clear from "./functions/clear"
import marketValue from "./functions/market-value"

/** This is the YNAB access token. */
export let token =
	process.env.TOKEN ||
	(() => {
		throw new Error(
			`No access token passed in ENV or token file. We won't be able talk with the API.`
		)
	})()

/** Whether we are currently debugging. */
export const debug = process.env.DEBUG === "true"

/** The YNAB API. */
export const api = new ynab.API(token)

/** The directory for the db. */
export const Storage = storage
	.init({ dir: path.join(__dirname, `db`) })
	.then(() => storage)

export type env = keyof typeof env
export const env = {
	budget: process.env.BUDGET_ID || `last-used`,
	rolloverPayee: process.env.ROLLOVER_PAYEE || `Budget rollover`,
	rolloverAccount: process.env.ROLLOVER_ACCOUNT || `Budget rollover`,
	rolloverCategory: process.env.ROLLOVER_CATEGORY || `Rollover offset`,
	futureCategory: process.env.FUTURE_CATEGORY || `Future budgeted`,
	inflowsCategory: process.env.INFLOWS_CATEGORY || `Inflow: Ready to Assign`,
	creditCardPayments: process.env.PAYMENTS_GROUP || `Credit Card Payments`,
	groupsToOffset: process.env.GROUPS_TO_OFFSET?.split(`,`) || [`Unbudgeted`]
} as const

export type Key = keyof typeof Key
export const Key = {
	rolloverAccountId: `${env.budget}_account_${env.rolloverAccount}`,
	rolloverPayeeId: `${env.budget}_payee_${env.rolloverPayee}`,
	paymentsRolloverAndInflowsGroupIds: `${env.budget}_paymentsGroup_${
		env.creditCardPayments
	}_${env.rolloverCategory}_${env.futureCategory}_${
		env.inflowsCategory
	}_${env.groupsToOffset.join(`_`)}`,
	monthsKnowledge: `${env.budget}_months_knowledge`,
	monthsData: `${env.budget}_months_data`,
	rolloverTransactionsKnowledge: `${env.budget}_rollover_transactions_knowledge`,
	rolloverTransactionsData: `${env.budget}_rollover_transactions_data`
} as const

async function run() {
	const action = process.argv[2]

	switch (action) {
		case `schedule`:
			cron.schedule(`*/2 * * * *`, apply)

			return
		case `apply`:
			return apply()
		case `zero`:
			return zero()
		case `clear`:
			return clear()
		case `market-value`:
			return marketValue()
	}

	// tslint:disable-next-line: no-unnecessary-type-assertion
	const response = (await prompt(
		`Which would you like?
    1. Apply rollover transactions.
    2. Update market value on accounts using other currencies.
    3. Zero out rollover transactions.
    4. Clear cache.
Type a number (q to quit): `,
		/[123q]/i
	)) as `1` | `2` | `3` | `4` | `q` | `Q`

	switch (response) {
		case `1`:
			return apply()
		case `2`:
			return marketValue()
		case `3`:
			return zero()
		case `4`:
			return clear()
		default:
			return undefined
	}
}

module.exports = run().catch((err) =>
	error(`An exception was thrown:`, err.detail || err.message || err.description || err)
)

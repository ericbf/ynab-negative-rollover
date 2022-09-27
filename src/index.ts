import "./globals"

import { readFileSync } from "fs"
import storage from "node-persist"
import path from "path"
import * as ynab from "ynab"

import { apply, clear, zero } from "./functions"
import { error, prompt } from "./helpers"
import { marketValue } from "./functions/market-value"

// This is the access token if we need it.
export let token = process.env.TOKEN && process.env.TOKEN.trim()

/** Whether we are currently debugging */
export const debug = Boolean(process.env.DEBUG)

if (!token) {
	try {
		const data = readFileSync(__filename.replace(/\.[^\.]+$/, `.token`))

		token = data.toString().trim()
	} catch {}

	if (!token) {
		error(
			`No access token passed in ENV or token file. We won't be able talk with the API.`
		)

		throw new Error(
			`No access token passed in ENV or token file. We won't be able talk with the API.`
		)
	}
}

export const api = new ynab.API(token)

/** The directory for the db. */
export const Storage = storage
	.init({ dir: path.join(__dirname, `db`) })
	.then(() => storage)

export type Name = keyof typeof Name
export const Name = {
	budget: process.env.BUDGET_ID || `last-used`,
	rolloverPayee: process.env.ROLLOVER_PAYEE || `Budget rollover`,
	rolloverAccount: process.env.ROLLOVER_ACCOUNT || `Budget rollover`,
	rolloverCategory: process.env.ROLLOVER_CATEGORY || `Rollover offset`,
	futureCategory: process.env.ROLLOVER_CATEGORY || `Future budgeted`,
	inflowsCategory: process.env.INFLOWS_CATEGORY || `Inflow: Ready to Assign`,
	creditCardPayments: process.env.PAYMENTS_GROUP || `Credit Card Payments`,
	groupsToOffset: process.env.GROUPS_TO_OFFSET?.split(`,`) || [`Unbudgeted`]
} as const

export type Key = keyof typeof Key
export const Key = {
	rolloverAccountId: `${Name.budget}_account_${Name.rolloverAccount}`,
	rolloverPayeeId: `${Name.budget}_payee_${Name.rolloverPayee}`,
	paymentsRolloverAndInflowsGroupIds: `${Name.budget}_paymentsGroup_${
		Name.creditCardPayments
	}_${Name.rolloverCategory}_${Name.futureCategory}_${
		Name.inflowsCategory
	}_${Name.groupsToOffset.join(`_`)}`,
	monthsKnowledge: `${Name.budget}_months_knowledge`,
	monthsData: `${Name.budget}_months_data`,
	rolloverTransactionsKnowledge: `${Name.budget}_rollover_transactions_knowledge`,
	rolloverTransactionsData: `${Name.budget}_rollover_transactions_data`
} as const

async function run() {
	const action = process.argv[2]

	switch (action) {
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

import "./globals"

import { readFileSync } from "fs"
import storage from "node-persist"
import path from "path"
import * as ynab from "ynab"

import { applyRollovers, clearDb, zeroOutRollovers } from "./functions"
import { error, prompt } from "./helpers"

// This is the access token if we need it.
export let token = process.env.TOKEN! && process.env.TOKEN!.trim()

/** Whether we are currently debugging */
export const debug = false

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

export const api = new ynab.API(token)

/** The directory for the db. */
export const Storage = storage.init({ dir: path.join(__dirname, `db`) }).then(() => storage)

export enum StorageKey {
	account = "account",
	payee = "payee",
	groupAndTbb = "groupAndTbb"
}

export enum BudgetValue {
	budget = "last-used",
	toBeBudgeted = "To be Budgeted",
	budgetRollover = "Budget Rollover",
	creditCardPayments = "Credit Card Payments"
}

async function run() {
	// tslint:disable-next-line: no-unnecessary-type-assertion
	const response = (await prompt(
		`Which would you like?
    1. Apply rollover transactions.
    2. Zero out rollover transactions.
    3. Clear data base.
Type a number (q to quit): `,
		/[123q]/i
	)) as `1` | `2` | `3` | `q` | `Q`

	switch (response) {
		case `1`:
			return applyRollovers()
		case `2`:
			return zeroOutRollovers()
		case `3`:
			return clearDb()
		default:
			return undefined
	}
}

module.exports = run()

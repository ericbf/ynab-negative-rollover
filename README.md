# YNAB Negative Rollover

A script that enables you to rollover your negative balances in [YNAB](https://www.youneedabudget.com). I've contacted YNAB support multiple times to support this natively – they basically said they don't want to (stupid!). So I did it myself using their [API](https://api.youneedabudget.com). It's hacky, but it works for my family. The one downside that I don't really have a workaround for is that it messes up the "activity" total for a category with a rollover amount, as the rollover amount is rendered as a transaction.

## Dependencies

This only has a global dependency on [`node`](http://nodejs.org).

## Initializing

To install local dependencies, run `npm i`. Make sure you are providing the app your API token, otherwise it will not work.

You should create a payee called `Budget Rollover`, an account called `Budget Rollover`, and a category called `Rollover Offset`. You can set the inital balance of the account to zero and close it right away, and you can also hide the category after creating it.

### Parameters

You can pass parameters in the command line when running this. This is like standard parameters – for `*sh`, you can do something like `TOKEN=abcdefg BUDGET_ID="Secondary" npm run start`. If you run this with different a different budget name, then revert to the default, you may have to clear the cache to get it to point to the right budget.

`TOKEN`: your YNAB API token. This can also be added in an `index.token` file at the root of `src`.
`BUDGET_ID`: the ID of the budget that you want to apply this to. Defaults to `"last-used"`.
`ROLLOVER_PAYEE`: the payee to use for the rollover transactions. Defaults to `"Budget Rollover"`
`ROLLOVER_ACCOUNT`: the account to use for the rollover transactions. Defaults to `"Budget Rollover"`
`ROLLOVER_CATEGORY`: the category to use for the rollover transactions. Defaults to `"Rollover Offset"`
`INFLOWS_CATEGORY`: the name of the inflows category. Defaults to `"Inflows"`.
`PAYMENTS_GROUP`: the name of the credit card payments group. Defaults to `"Credit Card Payments"`.
`GROUPS_TO_OFFSET`: the comma separated names of the category groups that should be offset in the to be budgeted account (such as business expenses). Defaults to `"Ferreira.Life,Unbudgeted"`.

## Running

This can be run with `node . [apply|market-value|zero|clear]`. To automatically build then run, use `npm run start`.

- `apply`: runs the script to apply the rollover amounts to your budget.
- `market-value`: checks the latest market value of currencies that are noted in account notes and updates the account balance based on that value.
- `zero`: runs the script that zeros out all existing rollover transactions.
- `clear`: clears the local cache of saved IDs and transactions.

> If you want to build without running, run `npm run build`.

## Development

You can run the app with livereload enabled by running `npm run watch`.

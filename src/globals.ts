import { NonOptional, Stringlike } from "./helpers/types"

declare global {
	/**
	 * You can explicitly discard values by assigning it to `_`, as in:
	 *
	 * ```
	 * _ = doSomethingThatReturnsPromise()
	 * ```
	 */ // tslint:disable-next-line:no-any
	var _: any

	interface ObjectConstructor {
		entries<T extends {}, U extends keyof T>(obj: T): [Stringlike<U>, T[U]][]
		keys<T extends {}>(obj: T): Stringlike<keyof T>[]
		values<T extends {}, U extends keyof T>(obj: T): T[U][]
	}

	interface PromiseConstructor {
		/** Returns a promise that resolves after a certain number of milliseconds. */
		wait(milliseconds: number): Promise<void>
	}

	interface Array<T> {
		/** The first item in this array, or undefined if it is empty. */
		first?: T
		/** The last item in this array, or undefined if it is empty. */
		last?: T
		/** Filter out all undefined items. */
		filter(loose?: false): NonNullable<T>[]
		/** Filter out all falsey items. */
		filter(loose: true): NonOptional<T>[]
	}
}

// Define global._ so that you can throw away unused values with `_ = value`
Object.defineProperty(global, `_`, {
	set(_) { },
	enumerable: false,
	configurable: true
})

Object.defineProperty(Promise, `wait`, {
	async value(milliseconds: number) {
		return new Promise((resolve) => setTimeout(resolve, milliseconds))
	},
	enumerable: false,
	configurable: true
})

{
	// tslint:disable-next-line: no-any
	const filter = Array.prototype.filter as any

	Object.defineProperties(Array.prototype, {
		filter: {
			// tslint:disable-next-line: no-any
			value<T>(this: T[], ...args: any[]) {
				if (args.length === 0 || typeof args[0] === `boolean`) {
					if (args[0]) {
						return filter.call(this, (i: T) => i)
					} else {
						return filter.call(this, (i: T) => i !== undefined)
					}
				}

				return filter.call(this, ...args)
			},
			enumerable: false,
			configurable: true
		},
		first: {
			get<T>(this: T[]) {
				return this[0]
			},
			set<T>(this: T[], value: T) {
				this[0] = value
			},
			enumerable: false,
			configurable: true
		},
		last: {
			get<T>(this: T[]) {
				return this[this.length - 1]
			},
			set<T>(this: T[], value: T) {
				if (this.length === 0) {
					this[0] = value
				} else {
					this[this.length - 1] = value
				}
			},
			enumerable: false,
			configurable: true
		}
	})
}

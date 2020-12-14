import { NonOptional, Stringlike } from "./types"

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
		entries<Type extends {}, Key extends keyof Type>(
			obj: Type
		): [Stringlike<Key>, Type[Key]][]
		keys<Type extends {}>(obj: Type): Stringlike<keyof Type>[]
		values<Type extends {}, Key extends keyof Type>(obj: Type): Type[Key][]

		/**
		 * Map an object's values to the result of a mapper function.
		 *
		 * @param obj The object to map.
		 * @param mapper The mapper function to use.
		 * @returns A version of the object with its values mapped.
		 */
		map<Type extends {}, Key extends keyof Type, Value>(
			obj: Type,
			mapper: (key: Key, value: Type[Key]) => Value
		): { [K in Key]: Value }
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
		/** Find an item that matches this predicate, remove it from the array, and return it. */
		findAndRemove<This = void>(
			predicate: (this: This, value: T, index: number, array: T[]) => boolean,
			thisArg?: This
		): T | undefined
		/** Find all items that matches this predicate, remove them from the array, and return them. */
		removeMatching<This = void>(
			predicate: (this: This, value: T, index: number, array: T[]) => boolean,
			thisArg?: This
		): T[]
		/** Sort by the passed keys in ascending order. */
		sortBy(...keys: (keyof T)[]): T[]
		/**
		 * Search in an array and map the item. Return the first item with which the predicate/mapper returns true.
		 *
		 * @param array The array to search for the item with the mapper.
		 * @param predicate The predicate/mapper to use.
		 */
		mappedFind<U>(predicate: (element: T) => U | undefined): U

		/**
		 * Reduce the passed array to a map mapped by the passed prop.
		 * @param key The key whose value should be used as the index.
		 */
		indexBy<K extends keyof T>(this: T[], key: K): { [K in string]: T | undefined }
		/**
		 * Reduce an array to a map of arrays grouped by a prop
		 *
		 * @param key The key whose value should be used for the grouping.
		 */
		groupBy<K extends keyof T>(this: T[], key: K): { [K in string]: T[] | undefined }
	}
}

// Define global._ so that you can throw away unused values with `_ = value`
Object.defineProperty(global, `_`, {
	set(_) {},
	enumerable: false,
	configurable: true
})

Object.defineProperties(Object, {
	map: {
		value<T extends object, V>(
			obj: T,
			mapper: (key: keyof T, value: T[typeof key]) => V
		): { [K in keyof T]: V } {
			// tslint:disable-next-line: no-any
			return Object.entries(obj).reduce<any>((trans, [prop, value]) => {
				trans[prop] = mapper(prop as keyof T, value)

				return trans
			}, {})
		}
	}
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
			}
		},
		first: {
			get<T>(this: T[]) {
				return this[0]
			},
			set<T>(this: T[], value: T) {
				this[0] = value
			}
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
			}
		},
		findAndRemove: {
			value<T, This = void>(
				this: T[],
				predicate: (this: This, value: T, index: number, array: T[]) => boolean,
				thisArg?: This
			): T | undefined {
				const index = this.findIndex(predicate, thisArg)

				if (index >= 0) {
					return this.splice(index, 1)[0]
				}

				return undefined
			}
		},
		removeMatching: {
			value<T, This = void>(
				this: T[],
				predicate: (this: This, value: T, index: number, array: T[]) => boolean,
				thisArg?: This
			): T[] {
				const matches: T[] = []

				for (let i = this.length - 1; i >= 0; i -= 1) {
					if (predicate.call(thisArg!, this[i], i, this)) {
						matches.unshift(this.splice(i, 1)[0])
					}
				}

				return matches
			}
		},
		sortBy: {
			value<T>(this: T[], ...keys: (keyof T)[]) {
				return this.sort(
					(lhs, rhs) =>
						keys.mappedFind((key) =>
							lhs[key] < rhs[key] ? -1 : lhs[key] > rhs[key] ? 1 : 0
						) ?? 0
				)
			}
		},
		mappedFind: {
			value<T, U>(this: T[], predicate: (element: T) => U | undefined) {
				for (const element of this) {
					const mapped = predicate(element)

					if (mapped) {
						return mapped
					}
				}

				return undefined
			}
		},
		indexBy: {
			value<K extends keyof T, T extends { [Key in K]?: string }>(this: T[], key: K) {
				return this.reduce<{ [K: string]: T | undefined }>((trans, next) => {
					trans[next[key] ?? `undefined`] = next

					return trans
				}, {})
			}
		},
		groupBy: {
			value<K extends keyof T, T extends { [Key in K]?: string }>(this: T[], key: K) {
				return this.reduce<{ [K: string]: T[] | undefined }>((trans, next) => {
					const arr = trans[next[key] ?? `undefined`]

					if (arr) {
						arr.push(next)
					} else {
						trans[next[key] ?? `undefined`] = [next]
					}

					return trans
				}, {})
			}
		}
	})
}

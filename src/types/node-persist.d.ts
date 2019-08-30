import persist from "node-persist"

declare module "node-persist" {
	interface InitOptions {
		dir?: string
		stringify?: typeof JSON["stringify"]
		parse?: typeof JSON["parse"]
		encoding?: string
		logging?: boolean | (() => void)
		ttl?: boolean
		expiredInterval?: number
		forgiveParseErrors?: boolean
	}

	interface SetOptions {
		ttl?: number | Date
	}

	function create(options?: InitOptions): typeof persist

	async function init(options?: InitOptions): Promise<void>
	async function getItem<T>(key: string): Promise<T | undefined>
	async function setItem<T>(key: string, value: T, options?: SetOptions): Promise<void>
	async function updateItem<T>(key: string, value: T, options?: SetOptions): Promise<void>
	async function deleteItem<T>(key: string): Promise<void>
	async function clear(): Promise<void>
	async function values<T>(): Promise<T[]>
	async function valuesWithKeyMatch<T>(keyMatch: string | RegExp): Promise<T[]>
	async function keys(): Promise<string[]>
	async function length(): Promise<number>
}

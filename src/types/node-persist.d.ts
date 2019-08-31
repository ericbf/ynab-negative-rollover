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
	async function getItem<T = any>(key: string): Promise<T | undefined>
	async function setItem<T = any>(key: string, value: T, options?: SetOptions): Promise<void>
	async function updateItem<T = any>(key: string, value: T, options?: SetOptions): Promise<void>
	async function removeItem<T = any>(key: string): Promise<void>
	async function clear(): Promise<void>
	async function values<T = any>(): Promise<T[]>
	async function valuesWithKeyMatch<T = any>(keyMatch: string | RegExp): Promise<T[]>
	async function keys(): Promise<string[]>
	async function length(): Promise<number>
}

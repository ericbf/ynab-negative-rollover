import appRoot from "app-root-path"
import stackTrace from "stack-trace"

Error.stackTraceLimit = 100

type ConsoleMethods = Exclude<keyof Console, "Console">

// tslint:disable-next-line: no-any
/**
 * Proxy a console method with a prefix and timestamp.
 * @param which The console method to emulate.
 * @param prefix The prefix to add to the message.
 */
export function make<T extends ConsoleMethods>(which: T, prefix: string): Console[T]
/**
 * Proxy a console method with a prefix and timestamp.
 * @param which The console method to emulate.
 * @param stackLevel The stack depth to go to. Defaults to `1`.
 */
export function make<T extends ConsoleMethods>(which: T, stackLevel: number): Console[T]
/**
 * Proxy a console method with a prefix and timestamp.
 * @param which The console method to emulate.
 * @param prefix The prefix to add to the message.
 * @param stackLevel The stack depth to go to. Defaults to `1`.
 */
export function make<T extends ConsoleMethods>(which: T, prefix?: string, stackLevel?: number): Console[T]
export function make<T extends ConsoleMethods>(which: T, prefix: string | number = which, stackLevel = 1): Console[T] {
	if (typeof prefix === `number`) {
		stackLevel = prefix
		prefix = which
	}

	// tslint:disable-next-line: no-any
	return (...args: any[]) => {
		let stack: string | undefined

		if (stackLevel != undefined) {
			const frames = stackTrace.get()
			const site = frames[stackLevel] || frames.last
			const file = site.getFileName().split(`${appRoot.path}/`)[1]

			stack = ` ${file}:${site.getLineNumber()}:${site.getColumnNumber()}`
		}

		console[which](new Date().toISOString(), `[${prefix}]${stack || ``}`, ...args)
	}
}

export const log = make(`log`)
export const error = make(`error`)

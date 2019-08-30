import appRoot from "app-root-path"
import stackTrace from "stack-trace"

Error.stackTraceLimit = 100

type ConsoleMethods = Exclude<keyof Console, "Console">

// tslint:disable-next-line: no-any
export function make<T extends ConsoleMethods>(which: T, prefix: string): Console[T]
export function make<T extends ConsoleMethods>(which: T, stackLevel: number): Console[T]
export function make<T extends ConsoleMethods>(which: T, prefix?: string, stackLevel?: number): Console[T]
export function make<T extends ConsoleMethods>(which: T, prefix: string | number = which, stackLevel?: number): Console[T] {
	if (typeof prefix === `number`) {
		stackLevel = prefix
		prefix = which
	}

	// tslint:disable-next-line: no-any
	return (...args: any[]) => {
		let stack: string | undefined

		if (stackLevel != undefined) {
			const site = stackTrace.get()[stackLevel]
			const file = site.getFileName().split(`${appRoot.path}/`)[1]

			stack = ` ${file}:${site.getLineNumber()}:${site.getColumnNumber()}`
		}

		console[which](new Date().toISOString(), `[${prefix}]${stack || ``}`, ...args)
	}
}

export const log = make(`log`, 1)
export const error = make(`error`, 1)

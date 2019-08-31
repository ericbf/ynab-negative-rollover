/** Assert the type of a value at compile-time. */
export function assertType<T>(_value: T) {
	return true
}

/**
 * Get the date for a given number of months from the reference point in the format `"2019-01-01"`.
 * @param month The number of months from the reference point.
 * @param startYear The year to start at. Defaults to `2019`.
 * @param startMonth The month to start at. Defaults to `0`.
 */
export function getMonth(month: number, startYear = 2019, startMonth = 0) {
	return new Date(startYear, startMonth + month, 1).toISOString().substring(0, 10)
}

/** Redure the passed array to a map mapped by the passed prop. */
export function reduceByProp<K extends keyof T, T extends { [Key in K]: string }>(key: K, array: T[]) {
	return array.reduce<{ [K: string]: T | undefined }>(
		(trans, next) => (trans[next[key]] = next) && trans,
		{}
	)
}

/**
 * Prompt the user for input, optionally expecting it to match a RegExp.
 *
 * @param question The question to ask the user. This does not pad the question with a space, so include a space if you wath that.
 * @param matching A RegExp that the response should match. If the response does not match this, the retry string will be used to ask again.
 * @param retry The string to use to ask again if the response does not match the RegExp. Defaults to `Try again. ${question}`.
 */
export async function prompt(question: string, matching = /.?/, retry = `Try again. ${question}`): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		process.stdin.resume()
		process.stdout.write(question)

		// tslint:disable-next-line: no-any
		const resolver = (data: any) => {
			process.off(`data`, resolver)
			resolve(data.toString().trim())
		}

		// tslint:disable-next-line: no-any
		const errorer = (error: any) => {
			process.stdin.off(`error`, errorer)
			reject(error)
		}

		process.stdin.on(`data`, resolver)
		process.stdin.on(`error`, reject)
	}).then((data) => {
		if (!matching.test(data)) {
			return prompt(retry, matching, retry)
		}

		return data
	})
}

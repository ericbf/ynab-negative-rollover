/**
 * Prompt the user for input, optionally expecting it to match a RegExp.
 *
 * @param question The question to ask the user. This does not pad the question with a space, so include a space if you wath that.
 * @param matching A RegExp that the response should match. If the response does not match this, the retry string will be used to ask again.
 * @param retry The string to use to ask again if the response does not match the RegExp. Defaults to `Try again. ${question}`.
 */
export default async function prompt(
	question: string,
	matching = /.?/,
	retry = `Try again. ${question}`
): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		// tslint:disable-next-line: no-any
		const resolver = (data: Buffer) => {
			off()
			resolve(data.toString().trim())
		}

		// tslint:disable-next-line: no-any
		const errorer = (error: any) => {
			off()
			reject(error)
		}

		const off = () => {
			process.stdin.pause()
			process.stdin.off(`data`, resolver)
			process.stdin.off(`error`, reject)
		}

		process.stdout.write(question)

		process.stdin.resume()
		process.stdin.on(`data`, resolver)
		process.stdin.on(`error`, errorer)
	}).then((data) => {
		if (!matching.test(data)) {
			return prompt(retry, matching, retry)
		}

		return data
	})
}

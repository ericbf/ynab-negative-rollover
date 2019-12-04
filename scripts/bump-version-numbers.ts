import appRoot from "app-root-path"
import { promises as fs } from "fs"

async function run() {
	process.chdir(appRoot.path)

	const packagePath = `package.json`
	const packageLockPath = `package-lock.json`

	const packageObj = JSON.parse((await fs.readFile(packagePath)).toString())

	/**
	 * The current version, as recorded in env.ts
	 */
	const currentVersion = packageObj.version

	const args = process.argv.slice(2)

	let version: string | undefined

	if (/^\d+(\.\d+){2}$/.test(args[0])) {
		version = args[0]
	}

	if (!version) {
		const versionAsArray = currentVersion.split(`.`)

		versionAsArray[2] = parseInt(versionAsArray[2], 10) + 1

		version = versionAsArray.join(`.`)
	}

	await Promise.all([
		// Write to the package.json file
		new Promise<void>((resolve, reject) => {
			packageObj.version = version

			const packageString = JSON.stringify(packageObj, undefined, `\t`)

			fs.writeFile(packagePath, `${packageString}\n`).then(resolve, reject)
		}),
		// Write to the package-lock.json file
		new Promise(async (resolve, reject) => {
			const data = await fs.readFile(packageLockPath)

			const packageLockObj = JSON.parse(data.toString())

			packageLockObj.version = version

			const packageLockString = JSON.stringify(packageLockObj, undefined, `\t`)

			fs.writeFile(packageLockPath, `${packageLockString}\n`).then(resolve, reject)
		})
	])
}

module.exports = run()

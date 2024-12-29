import { Storage } from "../index"

/** Clear the cached values from the db */
export default async function clear() {
	const storage = await Storage

	return storage.clear()
}

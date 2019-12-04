import { Storage } from "../index"

export async function clearCache() {
	const storage = await Storage

	return storage.clear()
}

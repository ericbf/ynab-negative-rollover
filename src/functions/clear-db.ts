import { Storage } from "../index"

export async function clearDb() {
	const storage = await Storage

	return storage.clear()
}

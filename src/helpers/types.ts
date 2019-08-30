export type UnionProp<P extends Key, T1, V1, T2, V2 = void, T3 = void, V3 = void, T4 = void, V4 = void, T5 = void, V5 = void> =
	{ [K in P]: T1 } & V1 |
	(V2 extends void
		? { [K in P]: T2 } & {}
		: { [K in P]: T2 } & V2) |
	(T3 | V3 extends void
		? { [K in P]: T1 } & V1
		: V3 extends void
			? { [K in P]: T3 }
			: { [K in P]: T3 } & V3) |
	(T4 | V4 extends void
		? { [K in P]: T1 } & V1
		: V4 extends void
			? { [K in P]: T4 }
			: { [K in P]: T4 } & V4) |
	(T5 | V5 extends void
		? { [K in P]: T1 } & V1
		: V5 extends void
			? { [K in P]: T5 }
			: { [K in P]: T5 } & V5)
export type TernaryProp<P extends Key, T, U> = UnionProp<P, true, T, false, U>
export type IfPropIsTrue<P extends Key, T> = UnionProp<P, true, T, false>
export type IfPropIsFalse<P extends Key, T> = UnionProp<P, false, T, true>
export type Optional<T> = T | undefined | null | false | 0 | ``
export type NonOptional<T> = Exclude<T, undefined | null | false | 0 | ``>
export type Loadable<T> = IfPropIsTrue<"loaded", T>
export type Never<T> = { [P in keyof T]?: never }
export type Omit<T, K extends Key> = Pick<T, Exclude<keyof T, K>>
export type Key = string | number | symbol
export type TypeOrFn<T> = T | (() => T)

export type Require<T, K extends keyof T> = Omit<T, K> & { [P in K]: NonNullable<T[P]> }
export type PartialProps<T, K extends keyof T> = Omit<T, K> & { [P in K]?: T[P] }

export type ValueOf<T extends {}> = T[keyof T]
export type Unpacked<T> =
	T extends (infer U)[] ? U :
	// tslint:disable-next-line: no-any
	T extends (...args: any[]) => infer V ? V :
	T extends Promise<infer W> ? W :
	T

export type Stringlike<T extends PropertyKey> = T extends string ? T : T extends number ? StringForNumber[T] : never

interface StringForNumber {
	0: `0`
	1: `1`
	2: `2`
	3: `3`
	4: `4`
	5: `5`
	6: `6`
	7: `7`
	8: `8`
	9: `9`
	10: `10`
	100: `100`
	1234: `1234`
	[n: number]: string
}

import * as t from 'io-ts'
import { withValidate } from 'io-ts-types'
import * as E from 'fp-ts/Either'
import { isNotEmptyString } from '@digital-magic/ts-common-utils/lib/type'
import { pipe } from 'fp-ts/pipeable'
import * as R from 'fp-ts/ReadonlyRecord'
import { Refinement } from 'fp-ts/function'
import { date } from 'io-ts-types/date'
import {
  dateInFutureRefinement,
  dateInPastRefinement,
  DateRefinement,
  hasValueRefinement,
  regexRefinement,
  stringLengthRefinement
} from '@digital-magic/fp-ts-extensions/lib/refinements'
import { Optional } from '@digital-magic/io-ts-extensions'

export const RefinementParamsKey = 'params'

export type RefinementParam = 'required' | 'min' | 'max' | 'type' | 'past' | 'future'
export type RefinementParams = Partial<Record<RefinementParam, string | number | boolean>>
// type ValidationErrors<T> = Partial<Record<keyof T, string>>

export type KeysOfType<T, TProp> = { [P in keyof T]: T[P] extends TProp ? P : never }[keyof T]

/*
function objectMap<T>(object: T, mapFn) {
  return Object.keys(object).reduce(function(result, key) {
    result[key] = mapFn(object[key])
    return result
  }, {})
}
*/

export const withRequired = <C extends Optional<t.Any>>(codec: C): C =>
  withValidate(codec, (i, c) => {
    const ctx = c.concat({ key: RefinementParamsKey, type: codec, actual: { required: true } })
    const e = codec.validate(i, ctx)
    if (E.isLeft(e)) {
      return e
    }
    const a = e.right
    return isNotEmptyString(a) ? t.success(a) : t.failure(a, ctx)
  })

export const withRequiredFields = <P extends t.Props>(
  codec: t.TypeC<P>,
  ...reqFields: ReadonlyArray<KeysOfType<P, Optional<t.Any>>>
): t.TypeC<P> =>
  t.type<P>(
    (pipe(
      (codec.props as unknown) as R.ReadonlyRecord<string, Optional<t.Any>>,
      R.mapWithIndex((n, p) => ((reqFields as ReadonlyArray<string>).includes(n) ? withRequired(p) : p))
    ) as unknown) as P,
    codec.name
  )
/*
const updateRequiredParam = (entry: t.ContextEntry): t.ContextEntry => {
  console.log(entry.key, entry.actual)
  return ({...entry, actual: {...(entry.actual as RefinementParams), required: true}})
}

export const withRequired = <C extends t.Any>(codec: C): C =>
  withValidate(
    codec,
    (i, c) => {
      const params: t.ContextEntry = pipe(
        c,
        A.findFirst((v: t.ContextEntry) => v.key === RefinementParamsKey),
        O.map(v => updateRequiredParam(v)),
        O.getOrElse(() => ({key: RefinementParamsKey, type: codec, actual: {required: true}}) as t.ContextEntry)
      )
      const ctx = c.filter(v => v.key !== RefinementParamsKey).concat(params)
      // console.log(c.filter(v => v.key === RefinementParamsKey))
      // console.log(ctx.filter(v => v.key === RefinementParamsKey))
      // console.log(JSON.stringify(c, undefined, 2))
      // console.log(JSON.stringify(ctx, undefined, 2))
      const e = codec.validate(i, ctx)
      if (isLeft(e)) {
        return e
      }
      const a = e.right
      return isNotEmptyString(a) ? t.success(a) : t.failure(a, ctx)
    },
    codec.name
  )
 */

export const brandWithParams = <C extends t.Any, N extends string, B extends { readonly [K in N]: symbol }>(
  codec: C,
  predicate: Refinement<t.TypeOf<C>, t.Branded<t.TypeOf<C>, B>>,
  params: RefinementParams,
  name: N
): t.BrandC<C, B> => {
  return new t.RefinementType(
    name,
    (u): u is t.TypeOf<C> => codec.is(u) && predicate(u),
    (i, c) => {
      const ctx = c.concat({ key: RefinementParamsKey, type: codec, actual: params })
      const e = codec.validate(i, ctx)
      if (E.isLeft(e)) {
        return e
      }
      const a = e.right
      return predicate(a) ? t.success(a) : t.failure(a, ctx)
    },
    codec.encode,
    codec,
    predicate
  )
}

export const brandedString = (name: string, min: number, max: number, type: string = 'string') =>
  brandWithParams(t.string, stringLengthRefinement(min, max), { required: true, min, max, type }, name)

export const brandedStringWithPattern = (name: string, pattern: RegExp, type: string = 'string') =>
  brandWithParams(t.string, regexRefinement(pattern), { required: true, type }, name)

export enum DateBoundary {
  Future,
  Past
}

// TODO: DateRefinement<never> doesn't look good. Figure out why can't use DateRefinement<Date>
const dateBoundaryToRefinement = (dateBoundary?: DateBoundary): DateRefinement<never> => {
  switch (dateBoundary) {
    case DateBoundary.Future:
      return dateInFutureRefinement<never>()
    case DateBoundary.Past:
      return dateInPastRefinement<never>()
    default:
      return hasValueRefinement<never>()
  }
}

export const brandedDate = (name: string, dateBoundary?: DateBoundary) => {
  const refinement = dateBoundaryToRefinement(dateBoundary)
  const future = dateBoundary === DateBoundary.Future
  const past = dateBoundary === DateBoundary.Past
  return brandWithParams(date, refinement, { required: true, future, past }, name)
}

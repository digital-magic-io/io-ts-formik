import * as t from 'io-ts'
import * as O from 'fp-ts/lib/Option'
import * as E from 'fp-ts/lib/Either'
import * as A from 'fp-ts/lib/ReadonlyArray'
import * as R from 'fp-ts/lib/Record'
import * as NEA from 'fp-ts/lib/NonEmptyArray'
import { getLastSemigroup } from 'fp-ts/lib/Semigroup'
import { fold } from 'fp-ts/lib/Monoid'
import { pipe } from 'fp-ts/lib/pipeable'
import { Predicate } from 'fp-ts/lib/function'
import { Reporter } from 'io-ts/lib/Reporter'
import { FormikErrors } from 'formik'
import { isNotEmptyString } from '@digital-magic/ts-common-utils/lib/type'
import { getDeepObjectSemigroup } from '@digital-magic/fp-ts-extensions/lib/Semigroup'
import { RefinementParams, RefinementParamsKey } from './index'

const pathSeparator = '.'

const isUnionType = ({ type }: t.ContextEntry): boolean => type instanceof t.UnionType

const keyPath = (ctx: t.Context): string =>
  ctx
    .map((c) => c.key)
    .filter((v) => isNotEmptyString(v) && v !== RefinementParamsKey)
    .join(pathSeparator)

// TODO: Refactor: why can't just use: not(A.takeLeftWhile) - result differs (have to resolve why)
export const takeUntil = <A = unknown>(predicate: Predicate<A>) => (as: ReadonlyArray<A>): ReadonlyArray<A> => {
  // eslint-disable-next-line functional/prefer-readonly-type
  const init: Array<A> = []

  // TODO: Functional approach would be more appreciated
  // eslint-disable-next-line functional/no-loop-statement,functional/no-let
  for (let i = 0; i < as.length; i++) {
    // eslint-disable-next-line functional/immutable-data
    init[i] = as[i]
    if (predicate(as[i])) {
      return init
    }
  }

  return init
}

type ErrorsArray = NEA.NonEmptyArray<t.ValidationError>

export type ErrorParams = {
  readonly path: string
  readonly value: unknown
  readonly expectedTypes: ReadonlyArray<string>
  readonly errorMessage?: string
  // type: t.Decoder<any, any>,
  // baseType?: t.Decoder<any, any>,
  // type: string,
  readonly baseType?: string
  readonly params?: RefinementParams
}

const groupByKey = NEA.groupBy((error: t.ValidationError) => pipe(error.context, takeUntil(isUnionType), keyPath))

const getValidationContext = (validation: t.ValidationError): ReadonlyArray<t.ContextEntry> => validation.context

// The actual error is last in context
const getErrorFromCtx = (validation: t.ValidationError): O.Option<t.ContextEntry> =>
  A.last(getValidationContext(validation))

/*
const errorMessageSimple = (expectedType: string, path: string, error: t.ValidationError) =>
  `Expecting: ${expectedType} at path: "${path}", but instead got: ${JSON.stringify(error.value)} (${error.message})`

const errorMessageUnion = (expectedTypes: string[], path: string, error: t.ValidationError) =>
  `Expecting one of: [${expectedTypes.join(', ')}], at path: "${path}", but instead got: ${JSON.stringify(error.value)} (${error.message})`
*/

// TODO: Expected types can be extracted from ValidationError inside this function - this must simplify caller functions
const ErrorParams = {
  of: (expectedTypes: ReadonlyArray<string>, path: string, error: t.ValidationError): ErrorParams => {
    // const ctxField = error.context.find(c => c.key.length > 0 && c.key !== RefinementParamsKey)!
    const ctxParams = error.context.find((c) => c.key === RefinementParamsKey)
    return {
      path: path,
      value: error.value,
      expectedTypes: expectedTypes,
      errorMessage: error.message,
      // type: ctxField.type.name,
      baseType: ctxParams?.type.name,
      params: ctxParams?.actual as RefinementParams
    }
  }
}

const findExpectedType = (ctx: ReadonlyArray<t.ContextEntry>): O.Option<t.ContextEntry> =>
  pipe(
    ctx,
    A.findIndex(isUnionType),
    O.chain((n) => A.lookup(n + 1, ctx))
  )

const formatValidationErrorOfUnion = (path: string, errors: ErrorsArray): O.Option<ErrorParams> => {
  // TODO: Duplications are created here (see test with nested structures)
  const expectedTypes = pipe(
    errors,
    A.map(getValidationContext),
    A.map(findExpectedType),
    A.compact,
    A.map(({ type }) => type.name)
  )

  return expectedTypes.length > 0
    ? O.some(
        /*errorMessageUnion(expectedTypes, path, NEA.head(errors))*/ ErrorParams.of(
          expectedTypes,
          path,
          NEA.head(errors)
        )
      )
    : O.none
}

const formatValidationCommonError = (path: string, error: t.ValidationError): O.Option<ErrorParams> =>
  pipe(
    error,
    getErrorFromCtx,
    O.map((errorContext) =>
      /*errorMessageSimple(errorContext.type.name, path, error)*/ ErrorParams.of([errorContext.type.name], path, error)
    )
  )

const format = (path: string, errors: ErrorsArray): O.Option<ErrorParams> =>
  NEA.tail(errors).length > 0
    ? formatValidationErrorOfUnion(path, errors)
    : formatValidationCommonError(path, NEA.head(errors))

export const formatValidationErrors = (errors: t.Errors): ReadonlyArray<ErrorParams> =>
  pipe(
    errors,
    groupByKey,
    R.mapWithIndex(format),
    R.compact,
    R.toArray,
    A.map(([, error]) => error)
  )

export type ErrorFormatter = (params: ErrorParams) => string

export type ErrorWithParamsReporter = Reporter<ReadonlyArray<ErrorParams>>

export const errorWithParamsReporter: ErrorWithParamsReporter = {
  report: (validation) =>
    pipe(
      validation,
      E.fold(formatValidationErrors, () => [])
    )
}

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions,functional/prefer-type-literal
export interface FormikErrorReporter<T> extends Reporter<FormikErrors<T>> {
  readonly report: (validation: t.Validation<T>, errorFormatter?: ErrorFormatter) => FormikErrors<T>
}

const defaultErrorFormatter: ErrorFormatter = (params) =>
  `Expecting one of: [${params.expectedTypes.join(', ')}], at path: "${params.path}", but instead got: ${JSON.stringify(
    params.value
  )} (${params.errorMessage ?? '-no error message-'})`

export const formatErrorMessages = (formatter: ErrorFormatter = defaultErrorFormatter) => (
  errors: ReadonlyArray<ErrorParams>
): ReadonlyArray<ErrorParams> =>
  pipe(
    errors,
    A.map((e) => {
      return {
        ...e,
        errorMessage: formatter(e)
      }
    })
  )

// eslint-disable-next-line @typescript-eslint/ban-types
const formikMapper = (path: string, message: string): object => {
  const levels = path.split(pathSeparator) as NEA.NonEmptyArray<string>

  const head = NEA.head(levels)
  // console.log(head)
  const rest = NEA.tail(levels)

  if (rest.length === 0) {
    return R.singleton(head, message)
  }

  const node = formikMapper(rest.join(pathSeparator), message)
  return R.singleton(head, node)
}

export const buildFormikErrors = <T>(errors: ReadonlyArray<ErrorParams>): FormikErrors<T> => {
  const foldErrors = fold(R.getMonoid(getDeepObjectSemigroup()))
  return foldErrors(errors.map((e) => formikMapper(e.path, e.errorMessage ?? '-no error-'))) as FormikErrors<T>
}

export const zipFormikErrors = <T>(errors: ReadonlyArray<ErrorParams>): FormikErrors<T> =>
  R.fromFoldableMap(getLastSemigroup<string>(), A.readonlyArray)(errors, (e: ErrorParams) => [
    e.path,
    e.errorMessage ?? '-no error-'
  ]) as FormikErrors<T>

export function formikErrorReporter<T>(): FormikErrorReporter<T> {
  return {
    report: (validation, errorFormatter): FormikErrors<T> =>
      pipe(
        validation,
        E.mapLeft(formatValidationErrors),
        E.mapLeft(formatErrorMessages(errorFormatter)),
        E.fold(buildFormikErrors, () => {
          return {} as FormikErrors<T>
        })
      )
  }
}

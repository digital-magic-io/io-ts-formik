import moment from 'moment'
import * as t from 'io-ts'
import { isLeft, isRight, left } from 'fp-ts/lib/Either'
import { NonEmptyString } from 'io-ts-types/lib/NonEmptyString'
import { ErrorFormatter, errorWithParamsReporter, formikErrorReporter } from '../src/io-ts-error-reporter'
import { hasValue, isEmptyString } from '@digital-magic/ts-common-utils/lib/type'
import { optional } from '@digital-magic/io-ts-extensions'
import {
  brandedDate,
  brandedString,
  brandedStringWithPattern,
  DateBoundary,
  RefinementParams,
  RefinementParamsKey,
  withRequired,
  withRequiredFields
} from '../src'

const MAX_STRING_LENGTH = 255

// Examples how to use different brands
const PhonePrefix = brandedString('PhonePrefix', 2, 5, 'phone prefix')
const PhoneNumber = brandedString('PhoneNumber', 2, 10, 'phone number')
const PastLocalTime = brandedDate('DateInPast', DateBoundary.Past)
const AddressLine = brandedString('AddressLine', 2, 10, 'address')
const EmailAddress = brandedStringWithPattern('EmailAddress', /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,4})+$/, 'email')

const Contacts = t.type({
  emails: t.array(EmailAddress),
  skype: NonEmptyString,
  phone: PhoneNumber,
  address: optional(AddressLine)
})

const LoginType = t.type({
  prefix: PhonePrefix,
  phone: PhoneNumber,
  last: PastLocalTime,
  contacts: Contacts
})
type LoginType = t.TypeOf<typeof LoginType>

const stringFormatter: ErrorFormatter = (params) => {
  if (params.params?.min || params.params?.max) {
    const min = params.params.min ? params.params.min : 0
    const max = params.params.max ? params.params.max : MAX_STRING_LENGTH
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    return `This field must be of length between ${min} and ${max}`
  }
  const type = params.params?.type ?? 'string'
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  return `Incorrect ${type} format!`
}

const dateFormatter: ErrorFormatter = (params) => {
  if (params.params?.future === true) {
    return 'Date must be in future'
  }
  if (params.params?.past === true) {
    return 'Date must be in past'
  }
  const type = params.params?.type ?? 'Date'
  // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
  return `Incorrect ${type} format!`
}

const errorFormatter: ErrorFormatter = (params) => {
  if (params.params?.required === true && isEmptyString(params.value)) {
    return 'This field is required!'
  }
  switch (params.baseType) {
    case 'string':
      return stringFormatter(params)
    case 'Date':
      return dateFormatter(params)
    default:
      return 'Incorrect format!'
  }
}

const expectValidationError = (result: t.Validation<unknown>): t.Errors => {
  if (!isLeft(result)) {
    fail('Failure decoding was expected, got: Success')
  }
  expect(result.left).toBeDefined()
  return result.left
}

const expectValidationSuccess: <T>(result: t.Validation<T>) => T = (result) => {
  if (!isRight(result)) {
    // eslint-disable-next-line no-console
    console.log(errorWithParamsReporter.report(result))
    fail('Success decoding was expected, got: Error')
  }
  expect(result.right).toBeDefined()
  return result.right
}

const expectErrorContext = (
  c: t.Context,
  expectedLength: number,
  expectedParams: RefinementParams,
  paramName: string = RefinementParamsKey
): void => {
  expect(c.length).toBe(expectedLength)
  const params = c.find((v) => v.key === paramName)
  if (hasValue(params)) {
    expect(params.actual).toStrictEqual(expectedParams)
  } else {
    // eslint-disable-next-line no-console
    console.log(c)
    fail(
      'Expected context param not found: ' +
        paramName +
        ', available params: ' +
        // tslint:disable-next-line:quotemark
        c.map((v) => `'${v.key}'`).join(', ')
    )
  }
}

test('Decoder context must be correctly composed and errorReporter must output correct errors', () => {
  const emptyLogin = {
    prefix: '',
    phone: 'd',
    last: moment().add(20, 'days').toDate(),
    contacts: {
      emails: ['E', ''],
      address: 'Z'
    }
  }

  const decoded = LoginType.decode(emptyLogin)
  const result = expectValidationError(decoded)

  expect(result.length).toBe(9)
  // field prefix
  expectErrorContext(result[0].context, 3, { max: 5, min: 2, required: true, type: 'phone prefix' })
  // field phone
  expectErrorContext(result[1].context, 3, { max: 10, min: 2, required: true, type: 'phone number' })
  // field last
  expectErrorContext(result[2].context, 3, { future: false, past: true, required: true })
  // field contacts.email.0
  expectErrorContext(result[3].context, 5, { required: true, type: 'email' })
  // field contacts.email.1
  expectErrorContext(result[4].context, 5, { required: true, type: 'email' })
  // Node contacts - nested structure (no validation info here)
  expect(result[5].context.length).toBe(3)
  // field contacts.phone
  expectErrorContext(result[6].context, 4, { max: 10, min: 2, required: true, type: 'phone number' })
  // field contacts.address
  expectErrorContext(result[7].context, 5, { max: 10, min: 2, required: true, type: 'address' })
  // Node address - union type (no validation info here)
  expect(result[8].context.length).toBe(4)

  // Check formik errors
  const errors = formikErrorReporter<LoginType>().report(decoded, errorFormatter)
  expect(errors).toStrictEqual({
    contacts: {
      address: 'This field must be of length between 2 and 10',
      emails: {
        0: 'Incorrect email format!',
        1: 'This field is required!'
      },
      phone: 'This field is required!',
      skype: 'Incorrect format!'
    },
    last: 'Date must be in past',
    phone: 'This field must be of length between 2 and 10',
    prefix: 'This field is required!'
  })

  /*
  // Output plain errors array
  if (isLeft(decoded)) {
    const res = decoded.left.map(v => {
      return {
        keys: v.context.map(c => c.key),
        value: v.value,
        message: v.message
      }
    })
    console.log(res)
  }

  // Output errors without formatting messages
  console.log(errorWithParamsReporter.report(decoded))
  const errors = formikErrorReporter<LoginType>().report(decoded, errorFormatter)
  //const e = errors.contacts?.emails?[0]?

  // Output errors with formatted messages
  console.log(errors)
  */
})

test('withRequired combinator must correctly update Decoder', () => {
  const decoder = optional(t.string)
  const decoded = expectValidationSuccess(decoder.decode(''))
  expect(decoded).toBe('')

  const reqDecoder = withRequired(decoder)
  const reqDecoded = expectValidationError(reqDecoder.decode(''))

  expect(reqDecoded.length).toBe(1)
  expectErrorContext(reqDecoded[0].context, 2, { required: true })

  const errors = formikErrorReporter<typeof reqDecoder>().report(left(reqDecoded), errorFormatter)
  expect(errors).toStrictEqual({ '': 'This field is required!' })
})

test('withRequired combinator must correctly update Decoder with branded types', () => {
  const BrandedString = brandedString('Branded', 2, 5, 'branded string')
  const decoder = t.type(
    {
      name: optional(BrandedString)
    },
    'NameObject'
  )

  const decoded = expectValidationSuccess(decoder.decode({}))
  expect(decoded.name).toBeUndefined()

  const reqDecoder = withRequiredFields(decoder, 'name')
  const reqDecoded = expectValidationSuccess(reqDecoder.decode({ name: 'test' }))
  expect(reqDecoded).toStrictEqual({ name: 'test' })

  const reqDecoded2 = expectValidationError(reqDecoder.decode({}))
  expect(reqDecoded2.length).toBe(1)
  expectErrorContext(reqDecoded2[0].context, 3, { required: true })

  const errors = formikErrorReporter<typeof reqDecoder>().report(left(reqDecoded2), errorFormatter)
  expect(errors).toStrictEqual({ name: 'This field is required!' })
})

test('withRequired combinator must correctly update Decoder with complex types', () => {
  const BrandedString = brandedString('Branded', 2, 5, 'branded string')
  const decoder = t.type(
    {
      name: optional(BrandedString),
      text: optional(t.string),
      value: optional(t.number)
    },
    'MyType'
  )
  const decoded = expectValidationSuccess(decoder.decode({}))
  expect(decoded.name).toBeUndefined()
  expect(decoded.text).toBeUndefined()
  expect(decoded.value).toBeUndefined()

  const reqDecoder = withRequiredFields(decoder, 'name', 'text', 'value')
  const reqDecoded = expectValidationError(reqDecoder.decode({}))
  expect(reqDecoded.length).toBe(3)
  expectErrorContext(reqDecoded[0].context, 3, { required: true })
  expectErrorContext(reqDecoded[1].context, 3, { required: true })
  expectErrorContext(reqDecoded[2].context, 3, { required: true })

  const errors = formikErrorReporter<typeof reqDecoder>().report(left(reqDecoded), errorFormatter)
  expect(errors).toStrictEqual({
    name: 'This field is required!',
    text: 'This field is required!',
    value: 'This field is required!'
  })
})

test('withRequired combinator must correctly update Decoder with simple nested types', () => {
  const nested = t.type({
    text: optional(NonEmptyString)
  })
  const decoder = t.type({
    content: optional(nested)
  })
  expectValidationSuccess(decoder.decode({ content: {} }))

  const decoded = expectValidationError(decoder.decode({ content: { text: '' } }))

  // TODO: Resolve problem with expectedTypes in console output
  // eslint-disable-next-line no-console
  console.log(errorWithParamsReporter.report(left(decoded)))

  const reqNestedErrors = formikErrorReporter<typeof decoder>().report(left(decoded), errorFormatter)
  expect(reqNestedErrors).toStrictEqual({
    content: 'Incorrect format!' // TODO: Incorrect result, content must not contain error, errors are in nested fields
  })
})

test('withRequired combinator must correctly update Decoder with complex nested types', () => {
  const decoder = t.type({
    name: optional(NonEmptyString),
    contacts: optional(Contacts)
  })
  const decoded = expectValidationSuccess(decoder.decode({}))
  expect(decoded.name).toBeUndefined()
  expect(decoded.contacts).toBeUndefined()

  const goodValue = {
    name: 'name',
    contacts: {
      emails: [],
      skype: 'my skype',
      phone: '55522346'
      // address: optional(AddressLine)
    }
  }
  const decoded2 = expectValidationSuccess(decoder.decode(goodValue))
  expect(decoded2.name).toBe('name')
  expect(decoded2.contacts).toBeDefined()

  const reqDecoder = withRequiredFields(decoder, 'name', 'contacts')
  const reqDecoded = expectValidationError(reqDecoder.decode({}))
  expect(reqDecoded.length).toBe(2)
  expectErrorContext(reqDecoded[0].context, 3, { required: true })
  expectErrorContext(reqDecoded[1].context, 3, { required: true })

  const errors = formikErrorReporter<typeof reqDecoder>().report(left(reqDecoded), errorFormatter)
  expect(errors).toStrictEqual({
    name: 'This field is required!',
    contacts: 'This field is required!'
  })

  // Example how to make required nested fields

  const reqNestedDecoder: typeof decoder = withRequiredFields(
    t.type(
      {
        // Build new time with the same structure
        name: decoder.props.name, // Fields that aren't changed we take from previous decoder
        contacts: optional(withRequiredFields(Contacts, 'address')) // nested types are updated with withRequiredFields
      },
      decoder.name
    ),
    'name',
    'contacts'
  )
  /*
  const reqNestedDecoder: typeof decoder = t.type({ // Build new time with the same structure
    name: decoder.props.name, // Fields that aren't changed we take from previous decoder
    contacts: optional(withRequiredFields(Contacts, 'address')) // nested types are updated with withRequiredFields
  }, decoder.name)
  */

  // Success check
  const reqGoodValue = {
    name: 'name',
    contacts: {
      emails: [],
      skype: 'my skype',
      phone: '55522346',
      address: 'My address'
    }
  }
  expectValidationSuccess(reqNestedDecoder.decode(reqGoodValue))

  // Totally empty input
  {
    const reqNestedDecoded = expectValidationError(reqNestedDecoder.decode({}))
    expect(reqNestedDecoded.length).toBe(2)

    const reqNestedErrors = formikErrorReporter<typeof reqNestedDecoder>().report(
      left(reqNestedDecoded),
      errorFormatter
    )
    expect(reqNestedErrors).toStrictEqual({
      name: 'This field is required!',
      contacts: 'This field is required!'
    })
  }

  // Empty input for nested structure
  {
    const reqBadValue = {
      name: '',
      contacts: {
        emails: [],
        skype: '',
        phone: ''
        // address: 'My address'
      }
    }
    const reqNestedDecoded = expectValidationError(reqNestedDecoder.decode(reqBadValue))
    // const reqNestedDecoded = expectValidationError(reqNestedDecoder.decode({name: '', contacts: {email: 'test', skype: '', phone: ''}}))
    expect(reqNestedDecoded.length).toBe(6)

    // TODO: Resolve problem with expectedTypes in console output
    // eslint-disable-next-line no-console
    console.log(errorWithParamsReporter.report(left(reqNestedDecoded)))

    const reqNestedErrors = formikErrorReporter<typeof reqNestedDecoder>().report(
      left(reqNestedDecoded),
      errorFormatter
    )
    expect(reqNestedErrors).toStrictEqual({
      name: 'This field is required!',
      contacts: 'This field is required!' // TODO: Incorrect result, contacts must not contain error, errors are in nested fields
    })
  }
})

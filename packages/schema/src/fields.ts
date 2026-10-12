/**
 * File Name: fields.ts
 * Purpose: Provides typed field builder functions (text, richtext, relation, group, etc.) for declaring CMS content type fields in defineObjectType.
 *
 * Author: Raghunath J
 * License: MIT
 *
 * Dependencies/Notes: Depends on @tangen/types for FieldInput, FieldConfig, and related types. All builders delegate to the internal build() function which merges flat config props with an optional nested config object.
 */
import type {
  FieldInput,
  StrictFieldInput,
  ConfigForType,
  FieldType,
  SubField,
  ComponentDef,
  FieldDefinition,
  ConditionalRule,
  FieldHooks,
  FieldValidateFn,
  DynamicOptionsFn,
  TextFieldConfig,
  SlugFieldConfig,
  RangeFieldConfig,
  EmailFieldConfig,
  UrlFieldConfig,
  PhoneFieldConfig,
  TextareaFieldConfig,
  RichtextFieldConfig,
  NumberFieldConfig,
  BooleanFieldConfig,
  DateFieldConfig,
  TimeFieldConfig,
  ColorFieldConfig,
  TagsFieldConfig,
  CodeFieldConfig,
  GeopointFieldConfig,
  CurrencyFieldConfig,
  RatingFieldConfig,
  SelectFieldConfig,
  MultiselectFieldConfig,
  RelationFieldConfig,
  ObjectFieldConfig,
  MediaFieldConfig,
  LinkFieldConfig,
  RepeaterFieldConfig,
  ComponentFieldConfig,
  JsonFieldConfig,
} from "@tangen/types";

type OptionItem = { label: string; value: string };

/** Common init props every field builder accepts (behavior is stripped by push). */
type BaseInit = {
  label: string;
  previousName?: string[];
  /**
   * Not accepted here. A required field is a validation rule and lives with
   * the other rules: `validation: { required: true }`. One form, so a schema
   * reads the same everywhere and the rule sits beside `minLength`,
   * `pattern` and `unique`.
   */
  required?: never;
  /** Soft-disable: keep the column + data but hide the field from every runtime
   *  surface (admin, REST, TangenQL, GraphQL). Reversible; push keeps the column. */
  disabled?: boolean;
  hooks?: FieldHooks;
  validate?: FieldValidateFn;
};

/**
 * Two places, one rule. The TOP LEVEL of a builder holds what the field is on
 * the platform: identity (`label`, `previousName`, `disabled`), behaviour
 * (`hooks`, `validate`), localization and indexing (`localized`, `index`),
 * exposure (`mcp`, `knowledge`), the rules (`validation`) and the editor's
 * presentation (`admin`). `config` holds the type's OWN options - `default`,
 * `options`, `accept`, `targetType`, `min`, `fields`, `ai`, … - and only those.
 * A type option at the top level, or a top-level key under `config`, is a
 * compile error here and a refusal at `tangen check`.
 */
type TopLevelKey = 'localized' | 'index' | 'mcp' | 'knowledge' | 'validation' | 'admin';
type TypeOptions<C> = Omit<C, TopLevelKey>;
type FlatOf<C> = Pick<C, Extract<TopLevelKey, keyof C>>;
type NoFlatTypeOptions<C> = { [K in keyof TypeOptions<C>]?: never };

/** Init for a field builder whose type options are all optional. */
type InitFor<C> = BaseInit & FlatOf<C> & { config?: TypeOptions<C> } & NoFlatTypeOptions<C>;

/** Init whose config must contain R's keys (the rest of the type options stay optional). */
type InitWithConfig<C, R> = BaseInit & FlatOf<C> & {
  config: R & Omit<TypeOptions<C>, keyof R>;
} & NoFlatTypeOptions<C>;

const TOP_LEVEL_KEYS = new Set<string>(['localized', 'index', 'mcp', 'knowledge', 'validation', 'admin']);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build<K extends keyof ConfigForType>(fieldType: K, init: any): Extract<StrictFieldInput, { fieldType: K }> {
  const {
    label,
    previousName,
    disabled,
    required,
    config: explicitConfig,
    hooks,
    validate,
    ...flat
  } = init;
  for (const key of Object.keys(flat)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Field "${label}": "${key}" is a ${String(fieldType)} option and lives under config - config: { ${key}: … }`);
    }
  }
  for (const key of Object.keys(explicitConfig ?? {})) {
    if (TOP_LEVEL_KEYS.has(key)) {
      throw new Error(`Field "${label}": "${key}" describes the field on the platform and is written at the top level of the builder, not under config`);
    }
  }
  const mergedConfig = { ...flat, ...explicitConfig };

  // One form. The shorthand was accepted and folded in until 2026-09-06; a
  // schema that still uses it fails here, at `tangen check`, with the fix.
  if (required !== undefined) {
    throw new Error(`Field "${label}": declare required under validation - validation: { required: ${required} } - not as a top-level option`);
  }

  // Dynamic select/multiselect: an options *function* moves out of config
  // (config must stay JSON-serializable for push) onto the field itself,
  // leaving a 'dynamic' marker the admin uses to fetch options at runtime.
  let dynamicOptions: DynamicOptionsFn | undefined;
  if (typeof mergedConfig.options === "function") {
    dynamicOptions = mergedConfig.options as DynamicOptionsFn;
    delete mergedConfig.options;
    mergedConfig.optionsSource = "dynamic";
  }

  return {
    label,
    helpText: mergedConfig.admin?.helpText,
    fieldType,
    config: mergedConfig,
    previousName,
    required: mergedConfig.validation?.required ?? false,
    ...(disabled ? { disabled: true } : {}),
    ...(hooks ? { hooks } : {}),
    ...(validate ? { validate } : {}),
    ...(dynamicOptions ? { dynamicOptions } : {}),
  } as Extract<StrictFieldInput, { fieldType: K }>;
}

// ── Simple fields (no required config properties) ────────────────────────────
// Each builder's init is its PER-TYPE config — inapplicable options are compile errors.

/** Builds a plain text (single-line) field definition. */
export const text = (init: InitFor<TextFieldConfig>) => build("text", init);
/** Builds a slug field: kebab-case identifier, unique per type, derivable from a source field. */
export const slug = (init: InitFor<SlugFieldConfig>) => build("slug", init);
/** Builds a range field: two numbers (min ≤ max) stored in ONE numrange column. */
export const range = (init: InitFor<RangeFieldConfig>) => build("range", init);
/** Builds an email field definition with format validation. */
export const email = (init: InitFor<EmailFieldConfig>) => build("email", init);
/** Builds a URL field definition. */
export const url = (init: InitFor<UrlFieldConfig>) => build("url", init);
/** Builds a phone number field definition. */
export const phone = (init: InitFor<PhoneFieldConfig>) => build("phone", init);
/** Builds a multi-line textarea field definition. */
export const textarea = (init: InitFor<TextareaFieldConfig>) => build("textarea", init);
/** Builds a rich text (TipTap/ProseMirror) field definition. */
export const richtext = (init: InitFor<RichtextFieldConfig>) => build("richtext", init);
/** Builds a numeric field definition. */
export const number = (init: InitFor<NumberFieldConfig>) => build("number", init);
/** Builds a boolean (toggle) field definition. */
export const boolean = (init: InitFor<BooleanFieldConfig>) => build("boolean", init);
/** Builds a date/date-time field definition. */
export const date = (init: InitFor<DateFieldConfig>) => build("date", init);
/** Builds a media (file/image) field definition. */
export const media = (init: InitFor<MediaFieldConfig>) => build("media", init);
/** Builds a raw JSON field definition. */
export const json = (init: InitFor<JsonFieldConfig>) => build("json", init);
/** Builds a time-of-day field (HH:MM[:SS], no date component). */
export const time = (init: InitFor<TimeFieldConfig>) => build("time", init);
/** Builds a color field (hex or rgb()/rgba() string). */
export const color = (init: InitFor<ColorFieldConfig>) => build("color", init);
/** Builds a free-form tags field (array of strings, GIN-indexable). */
export const tags = (init: InitFor<TagsFieldConfig>) => build("tags", init);
/** Builds a code snippet field — config.language is a display hint. */
export const code = (init: InitFor<CodeFieldConfig>) => build("code", init);
/** Builds a geographic point field ({ lat, lng }, stored as jsonb). */
export const geopoint = (init: InitFor<GeopointFieldConfig>) => build("geopoint", init);
/** Builds a currency amount field — config.currencyCode is a display hint. */
export const currency = (init: InitFor<CurrencyFieldConfig>) => build("currency", init);
/** Builds a rating field — config.max sets the scale (default 5). */
export const rating = (init: InitFor<RatingFieldConfig>) => build("rating", init);

// ── Fields with required config properties ───────────────────────────────────

/** A select/multiselect must declare where its options come from: a static array,
 *  an async resolver (moved to `dynamicOptions` at build time), or an explicit
 *  `optionsSource: 'dynamic'` marker (resolver/admin-source attached separately). A
 *  dedicated init (rather than InitWithConfig) because it omits BOTH discriminating
 *  keys — `keyof` over the union would collapse to `never` and strip neither. */
type SelectOptionsReq = { options: OptionItem[] | DynamicOptionsFn } | { optionsSource: "dynamic" };
type SelectInit<C> = BaseInit
  & { config: SelectOptionsReq & Omit<C, "options" | "optionsSource"> }
  & Omit<C, "options" | "optionsSource">;

/** select — options: a static array, an async resolver, or optionsSource:'dynamic' */
export const select = (init: SelectInit<SelectFieldConfig>) => build("select", init);

/** multiselect — options: a static array, an async resolver, or optionsSource:'dynamic' */
export const multiselect = (init: SelectInit<MultiselectFieldConfig>) => build("multiselect", init);

/** relation — config.targetType is required */
export const relation = (
  init: InitWithConfig<RelationFieldConfig, { targetType: string; many?: boolean }>,
) => build("relation", init);

/**
 * link — a destination that is either Tangen content (held by identity, so a
 * slug rename never touches the stored value) or an external URL. Restrict it
 * with `allowedKinds` / `allowedTargets` when a field should offer only one.
 */
export const link = (init: InitFor<LinkFieldConfig>) => build("link", init);

/** repeater — config.fields is required */
export const repeater = (
  init: InitWithConfig<RepeaterFieldConfig, { fields: SubField[] }>,
) => build("repeater", init);

/** component — config.components is required (inline defs and/or reusable names) */
export const component = (
  init: InitWithConfig<ComponentFieldConfig, { components: (string | ComponentDef)[] }>,
) => build("component", init);

/** object — polymorphic reference; config.include lists allowed content types */
export const object = (
  init: InitWithConfig<ObjectFieldConfig, { include: string[]; many?: boolean }>,
) => build("object", init);

/** group — admin-only visual grouping; no DB column is created for the group itself.
 *  Sub-fields become individual flat columns identical to top-level fields. */
export function group(init: {
  label: string;
  fields: Record<string, FieldInput>;
  collapsedByDefault?: boolean;
  /** Hide the entire group (and skip validation of its sub-fields) when this rule is not met. */
  conditionalVisibility?: ConditionalRule;
}): Extract<StrictFieldInput, { fieldType: 'group' }> {
  const groupFields: FieldDefinition[] = Object.entries(init.fields).map(
    ([name, f]) => ({
      name,
      label: f.label,
      helpText: f.helpText,
      fieldType: f.fieldType,
      config: f.config ?? {},
      previousName: f.previousName ?? [],
      required: f.required ?? false,
    }),
  );
  return {
    label: init.label,
    fieldType: "group",
    config: {
      groupFields,
      ...(init.collapsedByDefault ? { collapsedByDefault: true } : {}),
      ...(init.conditionalVisibility
        ? { admin: { conditionalVisibility: init.conditionalVisibility } }
        : {}),
    },
    required: false,
  } as Extract<StrictFieldInput, { fieldType: 'group' }>;
}

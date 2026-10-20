// Type declarations for the dependency-free Twenty tool contract
// (src/twenty-tool-contract.mjs) so the TS connector consumes it typed.
// Keep in lockstep with the .mjs.

export type RecordType = "contact" | "account";
export type MakeError = (code: number, message: string, data?: unknown) => Error;
export type ToolCallResult = {
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  [k: string]: unknown;
};
export type TwentyObjectTools = {
  readonly nameSingular: string;
  readonly find: string;
  readonly findOne: string;
  readonly create: string;
  readonly update: string;
};
export type FindPage<R = Record<string, unknown>> = { records: R[]; count: number };

export declare const FIND_PAGE_LIMIT: number;
export declare const VIEWS_LIMIT: number;
export declare const FIELD_METADATA_LIMIT: number;
export declare const LIST_FIELD: "inLists";
export type CustomField = { readonly objectType: RecordType; readonly name: string; readonly type: "TEXT" | "ARRAY" };
export declare const CONNECTOR_CUSTOM_FIELDS: ReadonlyArray<CustomField>;
export declare const LIST_FILTER_OPERAND: "CONTAINS";
export declare const LIST_VIEW_TYPE: "TABLE";
export declare const SLUG_PATTERN: RegExp;
export declare const OBJECTS: Readonly<Record<RecordType, TwentyObjectTools>>;

export declare class TwentyToolContractError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown);
}

export type EntryKind =
  | "tool result"
  | "content item"
  | "person answer"
  | "company answer"
  | "person page"
  | "company page"
  | "person"
  | "company"
  | "full name"
  | "emails"
  | "links"
  | "written answer"
  | "written"
  | "view"
  | "view filter"
  | "view query"
  | "object"
  | "field"
  | "created view"
  | "created view filter"
  | "created field";
export type EntryFieldType = "id" | "string" | "string?" | "number" | "count" | "true" | "boolean?" | "strings?" | "string|any" | "json" | "number?" | "object" | `@${string}`;
export declare const ENTRY_FIELDS: Readonly<Record<EntryKind, Readonly<Record<string, EntryFieldType>>>>;
export declare const TOOL_ANSWERS: Readonly<Record<string, string>>;
export declare function readEntries<R = Record<string, unknown>>(
  toolName: string,
  entries: unknown,
  kind: EntryKind,
  makeError?: MakeError,
): R[];
export declare function readAnswer(toolName: string, payload: unknown, makeError?: MakeError): unknown;
export declare function readToolOutput(toolName: string, callResult: ToolCallResult, makeError?: MakeError): unknown;
export declare function readFindPage<R = Record<string, unknown>>(toolName: string, payload: unknown, makeError?: MakeError): FindPage<R>;
export declare function readFindOne<R = Record<string, unknown>>(toolName: string, payload: unknown, makeError?: MakeError): R | null;
export declare function readWrittenId(toolName: string, payload: unknown, makeError?: MakeError): string;
export declare function readArrayAnswer<R = Record<string, unknown>>(toolName: string, payload: unknown, makeError?: MakeError): R[];
export declare function readCreatedEntity<R extends { id: string } = { id: string }>(
  toolName: string,
  payload: unknown,
  makeError?: MakeError,
): R;

export declare function personSearchFilter(query: string | null | undefined): Record<string, unknown>;
export declare function companySearchFilter(query: string | null | undefined): Record<string, unknown>;
export declare function emailFilter(email: string): Record<string, unknown>;
export declare function membershipFilter(slug: string): Record<string, unknown>;
export declare function splitPersonName(full: string | null | undefined): { firstName?: string; lastName?: string };
export declare function contactWriteFields(input: object): Record<string, unknown>;
export declare function accountWriteFields(input: object): Record<string, unknown>;
export declare function createRecordArgs(objectType: RecordType, input: object): Record<string, unknown>;
export declare function updateRecordArgs(
  objectType: RecordType,
  id: string,
  patch: object,
): Record<string, unknown> | null;
export declare function membershipUpdateArgs(id: string, slugs: string[]): { id: string; inLists: string[] };
export declare function findArgs(
  filter: Record<string, unknown> | null | undefined,
  page?: { limit?: number; offset?: number },
): Record<string, unknown>;
export declare function findOneArgs(id: string): { id: string };
export declare function getViewsArgs(objectType: RecordType): { objectNameSingular: string; limit: number };
export declare function getObjectMetadataArgs(): { limit: number };
export declare function getFieldMetadataArgs(objectMetadataId: string): { objectMetadataId: string; limit: number };
export declare function getViewFiltersArgs(viewId: string): { viewId: string };
export declare function getViewQueryParametersArgs(viewId: string): { viewId: string };
export declare function getObjectMetadataByIdArgs(id: string): { id: string; limit: 1 };
export declare function getFieldMetadataByIdArgs(id: string): { id: string; limit: 1 };
export declare function createFieldMetadataArgs(input: { objectMetadataId: string; name: string; type: string }): {
  objectMetadataId: string;
  type: string;
  name: string;
  label: string;
  isNullable: true;
};
export declare function createViewArgs(input: { name: string; objectType: RecordType }): {
  name: string;
  objectNameSingular: string;
  type: "TABLE";
};
export declare function createListFilterArgs(input: { viewId: string; fieldMetadataId: string; slug: string }): {
  viewId: string;
  fieldMetadataId: string;
  operand: "CONTAINS";
  value: string;
};

export declare function objectFor(objectType: RecordType): TwentyObjectTools;
export declare function trimHyphens(text: string | null | undefined): string;
export declare function slugify(name: string | null | undefined): string;
export declare function isSlug(value: unknown): value is string;
export declare function readListSlug(
  filters: unknown,
  listFieldMetadataId: string | null | undefined,
  makeError?: MakeError,
): string | null;
export declare function readListFieldId(fields: unknown, makeError?: MakeError): string | null;
export declare function readObjectIds(objects: unknown, makeError?: MakeError): { contact: string; account: string } | null;
export declare function readListSlugs(toolName: string, record: unknown, makeError?: MakeError): string[];
export declare function viewsAtCeiling(views: unknown): boolean;
export declare function slugsWith(current: string[], slug: string): string[] | null;
export declare function slugsWithout(current: string[], slug: string): string[] | null;
export declare function readAllPages<R = Record<string, unknown>>(
  callPage: (page: { limit: number; offset: number }) => Promise<FindPage<R>>,
  options: { toolName: string; want?: number; pageSize?: number; maxPages?: number; makeError?: MakeError },
): Promise<R[]>;

// People views (cinatra#3562).
export type ViewEntry = { id: string; name: string; type: string; objectMetadataId: string };
export type ViewFilterEntry = {
  id: string;
  viewId: string;
  fieldMetadataId: string;
  operand: string;
  value: unknown;
  subFieldName?: string | null;
  positionInViewFilterGroup?: number | null;
};
export type ViewQuery = { objectNameSingular: string; filter: Record<string, unknown>; viewType: string };
export type ViewLabels = { labelSingular: string; labelPlural: string };
export type ViewerDependence = {
  key: "view-filter-viewer-dependent" | "view-filter-value-not-text" | "view-filter-time-zone";
  filterId: string;
  detail: string;
};
export declare function refusal(makeError: MakeError, code: number, key: string, detail: string): Error;
export declare function readOneById<R extends { id: string } = { id: string } & Record<string, unknown>>(
  toolName: string,
  payload: unknown,
  id: string,
  makeError?: MakeError,
): R;
export declare function readViewFilters(payload: unknown, viewId: string, makeError?: MakeError): ViewFilterEntry[];
export declare function readViewQuery(payload: unknown, makeError?: MakeError): ViewQuery;
export declare const LISTED_VIEW_TYPES: ReadonlyArray<"TABLE" | "KANBAN" | "CALENDAR">;
export declare function isListedViewType(type: unknown): boolean;
export declare function renderViewName(name: string, labels: Partial<ViewLabels> | null | undefined): string | null;
export declare function memberFindFilter(filter: unknown, makeError?: MakeError): Record<string, unknown>;
export declare function viewerDependence(
  filters: ViewFilterEntry[],
  fieldTypeOf: (fieldMetadataId: string) => string | null | undefined | Promise<string | null | undefined>,
): Promise<ViewerDependence | null>;
export declare const VIEW_MEMBERS_MAX: number;
export declare function readMemberIds(
  callPage: (page: { limit: number; offset: number }) => Promise<unknown>,
  options: { toolName: string; want?: number; pageSize?: number; makeError?: MakeError },
): Promise<string[]>;
export declare function canonicalJson(value: unknown): string;

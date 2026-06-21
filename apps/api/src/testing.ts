import type { Database } from '@openrelay/db';
import type {
  ClipRow,
  DestinationRow,
  FriendConnectionRow,
  IngestRow,
  SceneRow,
  StreamRow,
  TwitchConnectionRow,
  UserRow,
} from '@openrelay/db';

/**
 * In-memory test seam standing in for `@openrelay/db`, plus drizzle-operator
 * stubs that produce plain predicates the fake understands. Tests wire the
 * operator stubs via `vi.mock('drizzle-orm', ...)` and inject the fake database
 * into `buildApp`, so the suite runs with NO external Postgres. Excluded from the
 * build (see tsconfig.build.json) — only imported by tests.
 */

interface Tables {
  users: UserRow[];
  streams: StreamRow[];
  ingests: IngestRow[];
  destinations: DestinationRow[];
  scenes: SceneRow[];
  friendConnections: FriendConnectionRow[];
  clips: ClipRow[];
  twitchConnections: TwitchConnectionRow[];
}

type TableName = keyof Tables;
type Row =
  | UserRow
  | StreamRow
  | IngestRow
  | DestinationRow
  | SceneRow
  | FriendConnectionRow
  | ClipRow
  | TwitchConnectionRow;
type AnyRecord = Record<string, unknown>;

export type Predicate = (row: AnyRecord) => boolean;
export interface OrderBy {
  field: string;
  dir: 'asc' | 'desc';
}

/** Maps a drizzle column object identity to its JS field name. */
const COLUMN_KEY = new WeakMap<object, string>();
/** Maps a drizzle table object identity to its {@link TableName}. */
const TABLE_NAME = new WeakMap<object, TableName>();

function columnKey(col: unknown): string {
  const key = COLUMN_KEY.get(col as object);
  if (key === undefined) {
    throw new Error('unknown column reference passed to fake db');
  }
  return key;
}

function tableName(ref: unknown): TableName {
  const name = TABLE_NAME.get(ref as object);
  if (name === undefined) {
    throw new Error('unknown table reference passed to fake db');
  }
  return name;
}

/**
 * Register the real Drizzle table objects so the fake can resolve which array a
 * query/operator targets, and index every column object to its JS key.
 */
export function registerFakeTables(refs: Record<TableName, object>): void {
  for (const [name, table] of Object.entries(refs)) {
    TABLE_NAME.set(table, name as TableName);
    for (const [key, value] of Object.entries(table as AnyRecord)) {
      if (value !== null && typeof value === 'object' && 'name' in value) {
        COLUMN_KEY.set(value, key);
      }
    }
  }
}

// Drizzle-operator stubs ------------------------------------------------------

export function eqStub(col: unknown, value: unknown): Predicate {
  const key = columnKey(col);
  return (row) => row[key] === value;
}

export function inArrayStub(col: unknown, values: readonly unknown[]): Predicate {
  const key = columnKey(col);
  const set = new Set(values);
  return (row) => set.has(row[key]);
}

export function andStub(...preds: Predicate[]): Predicate {
  return (row) => preds.every((p) => p(row));
}

export function ascStub(col: unknown): OrderBy {
  return { field: columnKey(col), dir: 'asc' };
}

export function descStub(col: unknown): OrderBy {
  return { field: columnKey(col), dir: 'desc' };
}

// Fake database ---------------------------------------------------------------

interface FindArgs {
  where?: Predicate;
  orderBy?: OrderBy;
}

/** Columns each table backfills with a `defaultNow()` timestamp on insert. */
const TIMESTAMP_COLUMNS: Record<TableName, readonly string[]> = {
  users: ['createdAt', 'updatedAt'],
  streams: ['createdAt', 'updatedAt'],
  ingests: ['createdAt'],
  destinations: ['createdAt'],
  scenes: [],
  friendConnections: ['createdAt'],
  clips: ['createdAt'],
  twitchConnections: ['createdAt', 'updatedAt'],
};

export class FakeDatabase {
  private readonly tables: Tables = {
    users: [],
    streams: [],
    ingests: [],
    destinations: [],
    scenes: [],
    friendConnections: [],
    clips: [],
    twitchConnections: [],
  };

  public readonly query: Record<
    TableName,
    {
      findFirst: (args?: FindArgs) => Promise<Row | undefined>;
      findMany: (args?: FindArgs) => Promise<Row[]>;
    }
  >;

  public constructor() {
    const makeQuery = (name: TableName) => ({
      findFirst: (args?: FindArgs): Promise<Row | undefined> =>
        Promise.resolve(this.runSelect(name, args)[0]),
      findMany: (args?: FindArgs): Promise<Row[]> => Promise.resolve(this.runSelect(name, args)),
    });
    this.query = {
      users: makeQuery('users'),
      streams: makeQuery('streams'),
      ingests: makeQuery('ingests'),
      destinations: makeQuery('destinations'),
      scenes: makeQuery('scenes'),
      friendConnections: makeQuery('friendConnections'),
      clips: makeQuery('clips'),
      twitchConnections: makeQuery('twitchConnections'),
    };
  }

  private runSelect(name: TableName, args?: FindArgs): Row[] {
    let rows = [...this.tables[name]] as AnyRecord[];
    if (args?.where) {
      rows = rows.filter(args.where);
    }
    if (args?.orderBy) {
      const { field, dir } = args.orderBy;
      rows = [...rows].sort((a, b) => {
        const av = a[field] as number | string;
        const bv = b[field] as number | string;
        if (av === bv) {
          return 0;
        }
        return (av < bv ? -1 : 1) * (dir === 'asc' ? 1 : -1);
      });
    }
    return rows as Row[];
  }

  public insert(ref: unknown): {
    values: (value: AnyRecord) => { returning: () => Promise<Row[]> } & Promise<void>;
  } {
    const name = tableName(ref);
    return {
      values: (value: AnyRecord) => {
        // Mimic the schema's `defaultNow()` timestamp columns, which the real
        // database fills in but the fake otherwise would not.
        const now = new Date().toISOString();
        const withDefaults: AnyRecord = { ...value };
        for (const column of TIMESTAMP_COLUMNS[name]) {
          withDefaults[column] ??= now;
        }
        const row = withDefaults as Row;
        this.tables[name].push(row as never);
        return Object.assign(Promise.resolve(), {
          returning: (): Promise<Row[]> => Promise.resolve([row]),
        });
      },
    };
  }

  public update(ref: unknown): {
    set: (patch: AnyRecord) => {
      where: (pred: Predicate) => { returning: () => Promise<Row[]> } & Promise<void>;
    };
  } {
    const name = tableName(ref);
    return {
      set: (patch: AnyRecord) => ({
        where: (pred: Predicate) => {
          const updated: Row[] = [];
          for (const row of this.tables[name] as AnyRecord[]) {
            if (pred(row)) {
              Object.assign(row, patch);
              updated.push(row as Row);
            }
          }
          return Object.assign(Promise.resolve(), {
            returning: (): Promise<Row[]> => Promise.resolve(updated),
          });
        },
      }),
    };
  }

  public delete(ref: unknown): { where: (pred: Predicate) => Promise<void> } {
    const name = tableName(ref);
    return {
      where: (pred: Predicate): Promise<void> => {
        this.tables[name] = (this.tables[name] as AnyRecord[]).filter((row) => !pred(row)) as never;
        return Promise.resolve();
      },
    };
  }
}

/** Build a {@link Database}-typed fake for injection into `buildApp`. */
export function createFakeDatabase(): { db: Database; fake: FakeDatabase } {
  const fake = new FakeDatabase();
  return { db: fake as unknown as Database, fake };
}

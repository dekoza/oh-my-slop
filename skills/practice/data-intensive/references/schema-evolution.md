# Schema Evolution

From Designing Data-Intensive Applications (Martin Kleppmann). Use when changing schemas, APIs, messages, or events that have existing consumers.

## Core Principle

**Schemas evolve.** Old readers must be able to read new data, and new readers must be able to read old data. Plan for both directions.

## Compatibility Directions

| Direction | Meaning | How to Achieve |
|---|---|---|
| **Forward compatibility** | Old code can read new data | New fields are optional. Old code ignores unknown fields. |
| **Backward compatibility** | New code can read old data | New fields have defaults. New code handles missing fields. |
| **Full compatibility** | Both directions work | Every change is both forward and backward compatible. |

## Schema Evolution Rules

### Adding a Field
- Make it **optional** with a default value.
- Old writers won't set it → new readers must handle the default.
- New writers will set it → old readers must ignore it.

### Removing a Field
- Make it **optional** first (deprecate).
- Stop writing it.
- Stop reading it.
- Delete it only after no reader depends on it.

### Renaming a Field
- Add the new name as an optional field.
- Write both old and new names during migration.
- Stop writing the old name after all readers are updated.

### Changing a Type
- Add a new field with the new type.
- Write both fields during migration.
- Migrate readers to the new field.
- Remove the old field.

## Encoding Formats and Compatibility

| Format | Forward Compatible | Backward Compatible | Notes |
|---|---|---|---|
| **JSON** | Yes (ignore unknown) | Yes (handle missing) | No schema enforcement. |
| **Protocol Buffers** | Yes (field numbers) | Yes (unknown fields ignored) | Best for RPC and storage. |
| **Avro** | Yes (with schema resolution) | Yes (with schema resolution) | Best for streaming and big data. |
| **Thrift** | Partial | Partial | Less flexible than Protobuf. |
| **CSV** | No | No | Column order matters. Avoid for evolving schemas. |

## API Versioning

| Strategy | When to Use |
|---|---|
| **URL versioning** (`/v1/`, `/v2/`) | Breaking changes that can't be made backward-compatible |
| **Header versioning** | Content negotiation, gradual migration |
| **Additive changes only** | Preferred. Never break existing clients. |

## Message and Event Evolution

For event streams and message queues:

1. **Add new event types** rather than changing existing ones.
2. **Add optional fields** to existing events.
3. **Version events** with a `schema_version` field if structural changes are needed.
4. **Keep old event types** in the stream until all consumers have migrated.
5. **Use a schema registry** (e.g., Confluent Schema Registry) to enforce compatibility.

## Database Migration Pattern: Expand-Contract

The safest way to change a database schema:

### Phase 1: Expand
- Add the new column/table.
- Write to both old and new.
- Read from the old.

### Phase 2: Migrate
- Backfill data into the new structure.
- Switch reads to the new.
- Write to both.

### Phase 3: Contract
- Stop writing to the old.
- Remove the old column/table (after confirming nothing reads it).

**Each phase is a separate deploy.** The system works at every stage.

## Common Mistakes

- **Breaking change without versioning:** Deploying a schema change that crashes old consumers.
- **Assuming all consumers update simultaneously:** In distributed systems, old and new versions coexist during rollout.
- **Removing fields too aggressively:** Just because your new code doesn't use a field doesn't mean nothing else does.
- **No schema registry for events:** Without enforcement, someone will break compatibility.

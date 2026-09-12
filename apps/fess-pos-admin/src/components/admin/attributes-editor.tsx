'use client';

// pos_users.attributes editor: typed name / value rows (text, number, yes-no), with JSON as an Advanced option (T2-25).
// User attributes have no schema, so the type follows each value.
import type { JsonObject } from '@/lib/types';
import type { Parsed } from './form-helpers';
import { type KvRow, ObjectEditor, type ObjectEditorState, objectEditorStateFrom, objectEditorStateToObject } from './object-editor';

export type KeyValueRow = KvRow;
export type AttributesState = ObjectEditorState;

/** Initial editor state for an object. */
export function attributesStateFrom(obj: JsonObject | null | undefined): AttributesState {
  return objectEditorStateFrom(obj);
}

/** The object the editor currently describes, or a message explaining what to fix. */
export function attributesStateToObject(state: AttributesState): Parsed<JsonObject> {
  return objectEditorStateToObject(state, { label: 'Attributes' });
}

export function AttributesEditor({
  state,
  onChange,
  disabled = false,
  error,
  id,
}: {
  state: AttributesState;
  onChange: (next: AttributesState) => void;
  disabled?: boolean;
  error?: string | null;
  id?: string;
}) {
  return (
    <ObjectEditor
      id={id}
      state={state}
      onChange={onChange}
      label="Attributes"
      disabled={disabled}
      error={error}
      keyLabel="Attribute"
      keyPlaceholder="e.g. region"
      valuePlaceholder="e.g. Gauteng"
      addLabel="Add attribute"
      emptyText="No attributes."
    />
  );
}

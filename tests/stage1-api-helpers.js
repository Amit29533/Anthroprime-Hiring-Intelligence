export async function reviewedMerge(db, survivor, retired, operation = crypto.randomUUID()) {
  const rpc = async (name, args) =>
    (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1)).join(',')})result`, args))
      .rows[0].result;
  const context = await rpc('api_duplicate_context', [survivor, retired]);
  return rpc('api_duplicate_decision', [
    survivor,
    retired,
    operation,
    context.head,
    'merged',
    'Reviewed merge in linked-record acceptance test',
    Object.fromEntries(context.fields.map((field) => [field, 'a'])),
  ]);
}

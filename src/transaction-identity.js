export async function importPlaidTransactionOnce(accountId, importedId, findByImportedId, importTransaction) {
  let existing = await findByImportedId(accountId, importedId);
  if (existing) return { transaction: existing, imported: false };
  await importTransaction();
  existing = await findByImportedId(accountId, importedId);
  if (!existing) throw new Error('Imported transaction could not be found by stable identity');
  return { transaction: existing, imported: true };
}

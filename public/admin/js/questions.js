document.getElementById('import-questions-btn').addEventListener('click', async () => {
  const fileInput = document.getElementById('excel-file');
  if (!fileInput.files.length) return window.ui.alert(t('admin.pickExcelFirst'), { icon: 'warning' });

  const formData = new FormData();
  formData.append('file', fileInput.files[0]);

  try {
    const data = await apiFetch('/admin/questions/import', { method: 'POST', body: formData });
    document.getElementById('import-result').textContent =
      t('admin.importSuccess', { created: data.created, total: data.totalRows }) + '\n' +
      (data.errors.length
        ? t('admin.importErrors', { detail: JSON.stringify(data.errors, null, 2) })
        : t('admin.importAllOk'));
  } catch (err) {
    document.getElementById('import-result').textContent = t('common.errorPrefix', { msg: err.message });
  }
});

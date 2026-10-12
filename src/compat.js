/* Host compatibility: choose APIs by capability, never call removed singular APIs on Zotero 10. */
var PaperZoteroCompat = (() => {
  const pane = () => Zotero.getMainWindow().ZoteroPane;
  const unique = values => [...new Set(values)];
  function rows() {
    const p = pane();
    if (typeof p.getCollectionTreeRows === 'function') return p.getCollectionTreeRows() || [];
    const row = p.getCollectionTreeRow?.();
    return row ? [row] : [];
  }
  function libraryIDs() {
    const p = pane();
    const ids = typeof p.getSelectedLibraryIDs === 'function'
      ? p.getSelectedLibraryIDs() : [p.getSelectedLibraryID?.()];
    return unique((ids || []).filter(id => Number.isInteger(id) && id > 0));
  }
  function singleLibraryID() {
    const ids = libraryIDs();
    if (ids.length !== 1) throw new Error('请先在左侧只选择一个目标文库，再创建笔记或分类。');
    return ids[0];
  }
  async function collectionItems() {
    const selected = rows();
    let result = [];
    if (!selected.length) {
      const ids = libraryIDs();
      if (!ids.length) throw new Error('请先在左侧选择分类、已保存搜索或文库。');
      for (const id of ids) result.push(...await Zotero.Items.getAll(id, false, false));
    }
    for (const row of selected) {
      let items;
      if (row.isCollection?.() && typeof row.ref?.getChildItems === 'function') {
        items = await row.ref.getChildItems();
      } else if (typeof row.getItems === 'function') {
        items = await row.getItems({ unfiltered: true });
      } else if (row.isLibrary?.()) {
        const id = row.ref?.libraryID || singleLibraryID();
        items = await Zotero.Items.getAll(id, false, false);
      } else {
        throw new Error('无法读取当前选择；请在左侧选择分类或文库后重试。');
      }
      result.push(...(items || []));
    }
    return [...new Map(result.filter(item => item?.isRegularItem?.() && !item.deleted)
      .map(item => [item.id, item])).values()];
  }
  function fulltext() {
    const api = Zotero.FullText || Zotero.Fulltext;
    if (!api) throw new Error('当前 Zotero 未提供全文索引接口。');
    return api;
  }
  function diagnostics() {
    return { hostVersion: String(Zotero.version || '未知'), supportedVersions: '9 / 10',
      selectionAPI: typeof pane().getCollectionTreeRows === 'function' ? 'multiple' : 'single' };
  }
  return { rows, libraryIDs, singleLibraryID, collectionItems, fulltext, diagnostics };
})();

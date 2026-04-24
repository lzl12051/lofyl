<script lang="ts">
  import type { LibraryAlbum } from '../types';

  export let albums: LibraryAlbum[] = [];
  export let onClose: () => void = () => {};
  export let onRenameCategory: (oldName: string, newName: string) => void | Promise<void> = () => {};
  export let onDeleteCategory: (name: string) => void | Promise<void> = () => {};
  export let onRemoveAlbumFromCategory: (albumId: string, category: string) => void | Promise<void> = () => {};

  /** 全库所有分类（有序）*/
  $: allCategories = [
    ...new Set(albums.flatMap((a) => a.categories ?? [])),
  ].sort((a, b) => a.localeCompare(b, 'zh'));

  /** 每个分类下的专辑列表 */
  $: albumsByCategory = Object.fromEntries(
    allCategories.map((cat) => [
      cat,
      albums.filter((a) => (a.categories ?? []).includes(cat)),
    ]),
  ) as Record<string, LibraryAlbum[]>;

  let expandedCategory: string | null = null;
  let editingCategory: string | null = null;
  let editingValue = '';
  let renameInputEl: HTMLInputElement | null = null;

  function toggleExpand(cat: string) {
    expandedCategory = expandedCategory === cat ? null : cat;
  }

  function startEdit(cat: string) {
    editingCategory = cat;
    editingValue = cat;
    setTimeout(() => renameInputEl?.select(), 0);
  }

  async function commitRename() {
    if (!editingCategory) return;
    const trimmed = editingValue.trim();
    if (trimmed && trimmed !== editingCategory) {
      await onRenameCategory(editingCategory, trimmed);
    }
    editingCategory = null;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void commitRename(); }
    else if (e.key === 'Escape') { editingCategory = null; }
  }

  function handleBackdropKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="backdrop" on:click={onClose} on:keydown={handleBackdropKey} role="dialog" tabindex="-1" aria-label="分类管理">
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="panel" on:click|stopPropagation>
    <div class="panel-head">
      <h2>分类管理</h2>
      <button class="close-btn" type="button" on:click={onClose} aria-label="关闭">✕</button>
    </div>

    {#if allCategories.length === 0}
      <div class="empty">
        <p>还没有任何分类。</p>
        <p class="hint">在"编辑专辑"中给专辑添加分类标签。</p>
      </div>
    {:else}
      <ul class="cat-list">
        {#each allCategories as cat}
          {@const albumsInCat = albumsByCategory[cat] ?? []}
          <li class="cat-row" class:expanded={expandedCategory === cat}>
            <div class="cat-row-head">
              <button class="expand-btn" type="button" on:click={() => toggleExpand(cat)}
                aria-expanded={expandedCategory === cat}>
                <span class="arrow">{expandedCategory === cat ? '▾' : '▸'}</span>
              </button>

              {#if editingCategory === cat}
                <input
                  class="rename-input"
                  bind:this={renameInputEl}
                  bind:value={editingValue}
                  on:keydown={handleRenameKeydown}
                  on:blur={() => void commitRename()}
                />
              {:else}
                <button class="cat-name" type="button" on:click={() => toggleExpand(cat)}>
                  {cat}
                </button>
              {/if}

              <span class="cat-count">{albumsInCat.length} 张</span>

              <div class="cat-actions">
                <button class="action-btn" type="button" title="重命名"
                  on:click={() => startEdit(cat)}>✏</button>
                <button class="action-btn action-btn--delete" type="button" title="删除此分类"
                  on:click={() => void onDeleteCategory(cat)}>删除</button>
              </div>
            </div>

            {#if expandedCategory === cat && albumsInCat.length > 0}
              <ul class="album-list">
                {#each albumsInCat as album}
                  <li class="album-row">
                    <div class="album-thumb">
                      {#if album.coverUrl}
                        <img src={album.coverUrl} alt="" />
                      {:else}
                        <span>{album.title.trim()[0] ?? 'L'}</span>
                      {/if}
                    </div>
                    <span class="album-title">{album.title}</span>
                    <button class="remove-btn" type="button"
                      title="从此分类移除"
                      on:click={() => void onRemoveAlbumFromCategory(album.id, cat)}>
                      移除
                    </button>
                  </li>
                {/each}
              </ul>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(8, 5, 2, 0.72);
    backdrop-filter: blur(4px);
    display: grid;
    place-items: center;
    padding: 32px;
  }
  .panel {
    width: 100%;
    max-width: 560px;
    max-height: 80vh;
    background:
      radial-gradient(ellipse at 50% 0%, rgba(255, 230, 190, 0.08), transparent 60%),
      linear-gradient(180deg, #f7eedc 0%, #f0e4c6 100%);
    border-radius: 18px;
    box-shadow:
      0 40px 80px rgba(0, 0, 0, 0.55),
      0 0 0 1px rgba(90, 58, 31, 0.22);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px 16px;
    border-bottom: 1px solid rgba(102, 69, 28, 0.18);
    flex-shrink: 0;
  }
  .panel-head h2 {
    font-family: "Cormorant Garamond", "Noto Serif SC", serif;
    font-size: 20px;
    font-weight: 700;
    color: #3a2410;
    letter-spacing: 0.05em;
  }
  .close-btn {
    background: none;
    border: none;
    color: #9a7a46;
    font-size: 18px;
    cursor: pointer;
    padding: 4px 8px;
    border-radius: 4px;
  }
  .close-btn:hover { color: #3a2410; }

  .empty {
    padding: 48px 24px;
    text-align: center;
    color: #7a5a30;
    font-family: "Noto Serif SC", serif;
  }
  .empty .hint {
    margin-top: 8px;
    font-size: 13px;
    opacity: 0.7;
  }

  .cat-list {
    list-style: none;
    overflow-y: auto;
    flex: 1;
    padding: 8px 0;
  }

  .cat-row {
    border-bottom: 1px solid rgba(102, 69, 28, 0.1);
  }
  .cat-row:last-child { border-bottom: none; }

  .cat-row-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 16px;
  }

  .expand-btn {
    background: none;
    border: none;
    color: #9a7a46;
    cursor: pointer;
    width: 22px;
    flex-shrink: 0;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .cat-name {
    flex: 1;
    background: none;
    border: none;
    text-align: left;
    font-family: "Noto Serif SC", serif;
    font-size: 15px;
    font-weight: 600;
    color: #3a2410;
    cursor: pointer;
    padding: 0;
  }
  .rename-input {
    flex: 1;
    border: 1px solid rgba(201, 154, 91, 0.6);
    border-radius: 5px;
    padding: 3px 8px;
    font-family: "Noto Serif SC", serif;
    font-size: 14px;
    color: #3a2410;
    background: rgba(255, 248, 235, 0.9);
    outline: none;
  }
  .rename-input:focus { border-color: #c9642d; }

  .cat-count {
    font-family: "JetBrains Mono", monospace;
    font-size: 11px;
    color: #9a7a46;
    letter-spacing: 0.05em;
    flex-shrink: 0;
  }
  .cat-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .action-btn {
    padding: 3px 8px;
    border: 1px solid rgba(102, 69, 28, 0.25);
    border-radius: 4px;
    background: rgba(255, 248, 235, 0.8);
    color: #7a5a30;
    font-size: 12px;
    cursor: pointer;
    font-family: "Noto Serif SC", serif;
  }
  .action-btn:hover { background: rgba(201, 154, 91, 0.25); }
  .action-btn--delete { color: #9f3a22; border-color: rgba(159, 58, 34, 0.3); }
  .action-btn--delete:hover { background: rgba(159, 58, 34, 0.12); }

  /* 展开的专辑列表 */
  .album-list {
    list-style: none;
    background: rgba(255, 245, 220, 0.5);
    border-top: 1px solid rgba(102, 69, 28, 0.1);
    padding: 6px 16px 6px 46px;
  }
  .album-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 0;
    border-bottom: 1px solid rgba(102, 69, 28, 0.07);
  }
  .album-row:last-child { border-bottom: none; }
  .album-thumb {
    width: 32px;
    height: 32px;
    border-radius: 4px;
    overflow: hidden;
    background: linear-gradient(135deg, #d5a06b, #8f5f38);
    display: grid;
    place-items: center;
    flex-shrink: 0;
    color: #fff;
    font-weight: 700;
    font-size: 14px;
  }
  .album-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .album-title {
    flex: 1;
    font-family: "Noto Serif SC", serif;
    font-size: 13px;
    color: #4a3218;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .remove-btn {
    padding: 2px 8px;
    border: 1px solid rgba(102, 69, 28, 0.22);
    border-radius: 4px;
    background: transparent;
    color: #9a7a46;
    font-size: 11px;
    cursor: pointer;
    flex-shrink: 0;
    font-family: "Noto Serif SC", serif;
  }
  .remove-btn:hover { color: #9f3a22; border-color: rgba(159, 58, 34, 0.3); }
</style>

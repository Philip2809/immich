<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import ContextMenu from '$lib/components/shared-components/context-menu/context-menu.svelte';
  import { shortcuts } from '$lib/actions/shortcut';
  import { generateId } from '$lib/utils/generate-id';
  import { contextMenuNavigation } from '$lib/actions/context-menu-navigation';
  import { optionClickCallbackStore, selectedIdStore } from '$lib/stores/context-menu.store';
  import type { AssetResponseDto } from '@immich/sdk';

  export interface AssetContextMenu {
    asset: AssetResponseDto;
    position: {
      x: number;
      y: number;
    };
  }
  interface Props {
    title: string;
    direction?: 'left' | 'right';
    x?: number;
    y?: number;
    isOpen?: boolean;
    onClose: (() => unknown) | undefined;
    children?: Snippet;
  }

  let { title, direction = 'right', x = 0, y = 0, isOpen = false, onClose, children }: Props = $props();

  let uniqueKey = $state({});
  let menuContainer: HTMLUListElement | undefined = $state();
  let triggerElement: HTMLElement | undefined = $state(undefined);

  const id = generateId();
  const menuId = `context-menu-${id}`;

  const closeContextMenu = () => {
    setTimeout(() => {
      // triggerElement?.focus();
      onClose?.();
    }, 0);
  };
  $effect(() => {
    if (isOpen && menuContainer) {
      triggerElement = document.activeElement as HTMLElement;
      menuContainer.focus();
      $optionClickCallbackStore = closeContextMenu;
    }
  });
</script>

{#key uniqueKey}
  {#if isOpen}
    <div
      use:contextMenuNavigation={{
        closeDropdown: closeContextMenu,
        container: menuContainer,
        isOpen,
        selectedId: $selectedIdStore,
        selectionChanged: (id) => ($selectedIdStore = id),
      }}
      use:shortcuts={[
        {
          shortcut: { key: 'Tab' },
          onShortcut: closeContextMenu,
        },
        {
          shortcut: { key: 'Tab', shift: true },
          onShortcut: closeContextMenu,
        },
      ]}
    >
      <section class="fixed left-0 top-0 z-10 flex">
        <ContextMenu
          {direction}
          {x}
          {y}
          ariaActiveDescendant={$selectedIdStore}
          ariaLabel={title}
          bind:menuElement={menuContainer}
          id={menuId}
          isVisible
          onClose={closeContextMenu}
        >
          {@render children?.()}
        </ContextMenu>
      </section>
    </div>
  {/if}
{/key}

import { beforeEach, describe, expect, it } from 'vitest';
import { useEditStore } from './editStore.ts';

const s = () => useEditStore.getState();
const params = () => s().edits.p!.params;

describe('edit history', () => {
  beforeEach(() => useEditStore.setState({ edits: {} }));

  it('merges a slider drag into one undo step', () => {
    for (const v of [0.1, 0.4, 0.8]) s().update('p', (d) => void (d.light.exposure = v), { transient: true });
    s().commit('p');
    expect(params().light.exposure).toBe(0.8);
    expect(s().edits.p!.past).toHaveLength(1);
    s().undo('p');
    expect(params().light.exposure).toBe(0);
    s().redo('p');
    expect(params().light.exposure).toBe(0.8);
  });

  it('a new edit clears the redo stack', () => {
    s().update('p', (d) => void (d.light.contrast = 20));
    s().update('p', (d) => void (d.light.contrast = 40));
    s().undo('p');
    s().update('p', (d) => void (d.color.vibrance = 10));
    expect(s().edits.p!.future).toHaveLength(0);
    expect(params().light.contrast).toBe(20);
  });

  it('undo during an uncommitted drag returns to the drag start', () => {
    s().update('p', (d) => void (d.light.exposure = 1));
    s().update('p', (d) => void (d.light.exposure = 2), { transient: true });
    s().undo('p');
    expect(params().light.exposure).toBe(1);
  });

  it('a drag that ends where it started adds no history', () => {
    s().update('p', (d) => void (d.light.exposure = 1), { transient: true });
    s().update('p', (d) => void (d.light.exposure = 0), { transient: true });
    s().commit('p');
    expect(s().edits.p!.past).toHaveLength(0);
  });

  it('reset is undoable', () => {
    s().update('p', (d) => void (d.light.shadows = 50));
    s().reset('p');
    expect(params().light.shadows).toBe(0);
    s().undo('p');
    expect(params().light.shadows).toBe(50);
  });
});

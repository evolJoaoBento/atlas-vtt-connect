import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShareWithForm, type ShareRow } from '../../../../src/app/online/sharing/ui/ShareWithForm';

const rows: ShareRow[] = [{ key: 'k/ana', name: 'Ana', known: true }, { key: 'k/ben', name: 'Ben', known: true }, { key: 'name:Zed', name: 'Zed', known: false }];

describe('Share with form', () => {
  it('ticks people or everyone with exceptions, warns about unknown names and previews per person', async () => {
    const save = vi.fn();
    const preview = vi.fn(async (key: string) => `text for ${key}`);
    render(<ShareWithForm rows={rows} initial={{ everyone: false, people: ['k/ana', 'name:Zed'], except: [] }} map={null}
      preview={preview} warnings={['Not in your people list: Zed.']} onSave={save} onCancel={() => {}} />);
    expect(screen.getByText('Not in your people list: Zed.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Preview as'), { target: { value: 'k/ben' } });
    expect(await screen.findByText('text for k/ben')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Everyone in my sessions'));
    fireEvent.click(screen.getByLabelText('Except Ben'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith({ everyone: true, people: ['k/ana', 'name:Zed'], except: ['k/ben'], mode: 'player-safe', notes: [] });
  });

  it('for maps: player-safe or full, and linked notes, private ones disabled', () => {
    const save = vi.fn();
    render(<ShareWithForm rows={rows} initial={{ everyone: false, people: [], except: [] }}
      map={{ mode: 'player-safe', notes: [{ path: 'Notes/Inn.md', label: 'Inn', private: false }, { path: 'Notes/Plot.md', label: 'Plot', private: true }], ticked: [] }}
      preview={null} warnings={[]} onSave={save} onCancel={() => {}} />);
    fireEvent.click(screen.getByLabelText('Ana'));
    fireEvent.click(screen.getByLabelText('Full'));
    fireEvent.click(screen.getByLabelText('Inn'));
    expect((screen.getByLabelText('Plot') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText('Private')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith({ everyone: false, people: ['k/ana'], except: [], mode: 'full', notes: ['Notes/Inn.md'] });
  });

  it('lists an unknown name under except, so it can be unticked', () => {
    const save = vi.fn();
    render(<ShareWithForm rows={rows} initial={{ everyone: true, people: [], except: ['name:Zed'] }} map={null} preview={null} warnings={[]} onSave={save} onCancel={() => {}} />);
    expect((screen.getByLabelText('Except Zed') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Except Ana')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Except Zed'));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ everyone: true, except: [] }));
  });

  it('a player-safe share does not offer notes only hidden things link to', () => {
    render(<ShareWithForm rows={rows} initial={{ everyone: true, people: [], except: [] }}
      map={{ mode: 'player-safe', notes: [{ path: 'Notes/Inn.md', label: 'Inn', private: false }, { path: 'Notes/Plot.md', label: 'Plot', private: false, hidden: true }], ticked: ['Notes/Plot.md'] }}
      preview={null} warnings={[]} onSave={() => {}} onCancel={() => {}} />);
    expect(screen.queryByLabelText('Plot')).toBeNull();
    fireEvent.click(screen.getByLabelText('Full'));
    expect(screen.getByLabelText('Plot')).toBeTruthy();
  });

  it('offers only Full for a lit map, and says why', () => {
    const save = vi.fn();
    render(<ShareWithForm rows={rows} initial={{ everyone: true, people: [], except: [] }}
      map={{ mode: 'player-safe', notes: [], ticked: [], playerSafeRefused: 'Lit maps go Full.' }}
      preview={null} warnings={[]} onSave={save} onCancel={() => {}} />);
    expect((screen.getByLabelText('Player-safe') as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText('Full') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText('Lit maps go Full.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ mode: 'full' }));
  });
});

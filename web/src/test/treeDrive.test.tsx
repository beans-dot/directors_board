import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DateFolder, DriveNode } from '../api/types';
import { TreeNode } from '../components/tree/TreeNode';
import { useTree } from '../state/tree';

const child: DriveNode = {
  id: 'sub-folder',
  name: '별첨',
  kind: 'folder',
  mimeType: 'application/vnd.google-apps.folder',
  isPdf: false,
  path: '26.11.02./별첨',
  children: [],
};

const dateFolder: DateFolder = {
  id: 'folder abc',
  name: '26.11.02.',
  kind: 'folder',
  mimeType: 'application/vnd.google-apps.folder',
  isPdf: false,
  path: '26.11.02.',
  folderDate: '26.11.02.',
  dateKey: '2026-11-02',
  children: [child],
};

describe('date folder drive shortcut', () => {
  it('does not link a date folder to Google Drive', () => {
    useTree.setState({ expanded: { 'folder abc': true } });
    render(<TreeNode node={dateFolder} depth={0} />);
    expect(screen.queryByRole('link', { name: /구글 드라이브에서 열기/ })).toBeNull();
    expect(screen.getByRole('button', { name: /26\.11\.02\./ }).getAttribute('aria-expanded')).toBe('true');
  });
});

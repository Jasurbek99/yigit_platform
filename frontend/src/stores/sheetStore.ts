import { create } from 'zustand';

interface IActiveCell {
  shipmentId: number;
  rowKey: string;
}

interface ISheetState {
  activeCell: IActiveCell | null;
  setActiveCell: (cell: IActiveCell | null) => void;
  editingCell: IActiveCell | null;
  setEditingCell: (cell: IActiveCell | null) => void;
  searchText: string;
  setSearchText: (text: string) => void;
  showGapyOnly: boolean;
  setShowGapyOnly: (val: boolean) => void;
}

export const useSheetStore = create<ISheetState>((set) => ({
  activeCell: null,
  setActiveCell: (cell) => set({ activeCell: cell }),
  editingCell: null,
  setEditingCell: (cell) => set({ editingCell: cell }),
  searchText: '',
  setSearchText: (text) => set({ searchText: text }),
  showGapyOnly: false,
  setShowGapyOnly: (val) => set({ showGapyOnly: val }),
}));

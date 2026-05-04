export interface DefFrame {
  frameName: string;
  width: number;
  height: number;
  fullWidth: number;
  fullHeight: number;
  x: number;
  y: number;
  data: Uint8Array;
}

export interface DefGroup {
  groupType: number;
  filenames: string[];
  frames: DefFrame[];
}

export interface DefSprite {
  type: number;
  fullWidth: number;
  fullHeight: number;
  palette: Uint8Array;
  groups: DefGroup[];
}
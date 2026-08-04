/** 文件选择器过滤规则；与 Electron `dialog` 的 FileFilter 对齐。 */
export interface FilePickerFilter {
  /** 展示名，例如 `Images`。 */
  name: string;
  /** 扩展名列表（不含点），例如 `['png', 'jpg']`；`*` 表示任意。 */
  extensions: string[];
}

/** 文件选择器选项；与 Electron `dialog.showOpenDialog` 子集对齐。 */
export interface FilePickerOptions {
  /** 标题；不传时使用系统默认。 */
  title?: string;
  /** 起始目录；不传时使用系统最近目录。 */
  defaultPath?: string;
  /** 文件类型过滤；多组之间为 OR 关系。 */
  filters?: FilePickerFilter[];
  /** 是否允许多选；默认 false。 */
  multiSelections?: boolean;
}

/** 文件夹选择器选项；与 Electron `dialog.showOpenDialog` 子集对齐。 */
export interface DirectoryPickerOptions {
  /** 标题；不传时使用系统默认。 */
  title?: string;
  /** 起始目录；不传时使用系统最近目录。 */
  defaultPath?: string;
}

/** 选择结果：用户取消时返回 null，否则返回绝对路径（多选时为多个）。 */
export type FilePickerResult = string[] | null;
export type DirectoryPickerResult = string | null;

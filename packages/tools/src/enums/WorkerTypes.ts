/**
 * Worker Types are used to define the types the worker that is getting performed
 */
enum ChangeTypes {
  POLYSEG_CONTOUR_TO_LABELMAP = 'polySeg/convertContourToVolumeLabelmap',

  POLYSEG_SURFACE_TO_LABELMAP = 'polySeg/convertSurfacesToVolumeLabelmap',

  POLYSEG_CONTOUR_TO_SURFACE = 'polySeg/convertContourToSurface',

  POLYSEG_LABELMAP_TO_SURFACE = 'polySeg/convertLabelmapToSurface',

  DISPLAY_TOOL_CLIP_SURFACE = 'displayTool/clipSurface',
}

export default ChangeTypes;

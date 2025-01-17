import { utilities as csUtils } from '@cornerstonejs/core';
import type { Types } from '@cornerstonejs/core';
import {
  AnnotationCompletedEventType,
  AnnotationModifiedEventType,
  AnnotationRemovedEventType,
} from '../../../types/EventTypes';
import { state as annotationState } from '../../../stateManagement/annotation';
import type AnnotationGroupSelector from '../../../types/AnnotationGroupSelector';
import getInterpolationDataCollection from '../../contours/interpolation/getInterpolationDataCollection';
import type {
  InterpolationViewportData,
  AcceptInterpolationSelector,
} from '../../../types/InterpolationTypes';
import interpolate from '../../contours/interpolation/interpolate';
import deleteRelatedAnnotations from './deleteRelatedAnnotations';
import { InterpolationROIAnnotation } from '../../../types/ToolSpecificAnnotationTypes';
import ChangeTypes from '../../../enums/ChangeTypes';
import getViewportForAnnotation from '../../getViewportForAnnotation';

const { uuidv4 } = csUtils;

const ChangeTypesForInterpolation = [
  ChangeTypes.HandlesUpdated,
  ChangeTypes.InterpolationUpdated,
];

export default class InterpolationManager {
  static toolNames = [];

  static addTool(toolName: string) {
    if (!this.toolNames.includes(toolName)) {
      this.toolNames.push(toolName);
    }
  }

  /**
   * Accepts the autogenerated interpolations, marking them as non-autogenerated.
   * Can provide a selector to choose which ones to accept.
   *
   * Rules for which items to select:
   * 1. Only choose annotations having the same segment index and segmentationID
   * 2. Exclude all contours having the same interpolation UID as any other contours
   *    on the same slice.
   * 3. Exclude autogenerated annotations
   * 4. Exclude any reset interpolationUIDs (this is a manual operation to allow
   *    creating a new interpolation)
   * 5. Find the set of interpolationUID's remaining
   *    a. If the set is of size 0, assign a new interpolationUID
   *    b. If the set is of size 1, assign that interpolationUID
   *    c. Otherwise (optional, otherwise do b for size>1 randomly),
   *       for every remaining annotation, find the one whose center
   *       point is closest to the center point of the new annotation.
   *       Choose that interpolationUID
   *
   * To allow creating new interpolated groups, the idea is to just use a new
   * segment index, then have an operation to update the segment index of an
   * interpolation set.  That way the user can easily draw/see the difference,
   * and then merge them as required.
   * However, the base rules allow creating two contours on a single image to
   * create a separate set.
   */
  static acceptAutoGenerated(
    annotationGroupSelector: AnnotationGroupSelector,
    selector: AcceptInterpolationSelector = {}
  ) {
    const { toolNames, segmentationId, segmentIndex, sliceIndex } = selector;
    for (const toolName of toolNames || InterpolationManager.toolNames) {
      const annotations = annotationState.getAnnotations(
        toolName,
        annotationGroupSelector
      );
      if (!annotations?.length) {
        continue;
      }
      for (const annotation of annotations) {
        const { data, autoGenerated, metadata } = annotation;
        if (!autoGenerated) {
          continue;
        }
        if (segmentIndex && segmentIndex !== data.segmentation.segmentIndex) {
          continue;
        }
        if (
          sliceIndex !== undefined &&
          metadata &&
          sliceIndex !== metadata.sliceIndex
        ) {
          continue;
        }
        if (
          segmentationId &&
          segmentationId !== data.segmentation.segmentationId
        ) {
          continue;
        }
        annotation.autoGenerated = false;
      }
    }
  }

  static handleAnnotationCompleted = (evt: AnnotationCompletedEventType) => {
    const annotation = evt.detail.annotation as InterpolationROIAnnotation;
    if (!annotation?.metadata) {
      return;
    }
    const { toolName } = annotation.metadata;

    if (!this.toolNames.includes(toolName)) {
      return;
    }

    const viewport = getViewportForAnnotation(annotation);
    if (!viewport) {
      console.warn('Unable to find viewport for', annotation);
      return;
    }
    const sliceData: Types.ImageSliceData = getSliceData(viewport);
    const viewportData: InterpolationViewportData = {
      viewport,
      sliceData,
      annotation,
      interpolationUID: annotation.interpolationUID,
    };
    const hasInterpolationUID = !!annotation.interpolationUID;
    // If any update, triggered on an annotation, then it will be treated as non-autogenerated.
    annotation.autoGenerated = false;
    if (hasInterpolationUID) {
      // This has already been configured with matching details, so just run
      //  the interpolation again.
      deleteRelatedAnnotations(viewportData);
      interpolate(viewportData);
      return;
    }
    const filterData = [
      {
        key: 'segmentIndex',
        value: annotation.data.segmentation.segmentIndex,
        parentKey: (annotation) => annotation.data.segmentation,
      },
      {
        key: 'viewPlaneNormal',
        value: annotation.metadata.viewPlaneNormal,
        parentKey: (annotation) => annotation.metadata,
      },
      {
        key: 'viewUp',
        value: annotation.metadata.viewUp,
        parentKey: (annotation) => annotation.metadata,
      },
    ];
    let interpolationAnnotations = getInterpolationDataCollection(
      viewportData,
      filterData
    );
    // Skip other type of annotations with same location
    interpolationAnnotations = interpolationAnnotations.filter(
      (interpolationAnnotation) => interpolationAnnotation.interpolationUID
    );
    if (!annotation.interpolationUID) {
      annotation.interpolationUID =
        interpolationAnnotations[0]?.interpolationUID || uuidv4();
      viewportData.interpolationUID = annotation.interpolationUID;
    }
    interpolate(viewportData);
  };

  static handleAnnotationUpdate = (evt: AnnotationModifiedEventType) => {
    const annotation = evt.detail.annotation as InterpolationROIAnnotation;
    const { changeType = ChangeTypes.HandlesUpdated } = evt.detail;
    if (!annotation?.metadata) {
      return;
    }
    const { toolName } = annotation.metadata;

    if (
      !this.toolNames.includes(toolName) ||
      !ChangeTypesForInterpolation.includes(changeType)
    ) {
      return;
    }

    const viewport = getViewportForAnnotation(annotation);
    if (!viewport) {
      console.warn(
        'Unable to find matching viewport for annotation interpolation',
        annotation
      );
      return;
    }
    annotation.autoGenerated = false;

    const sliceData: Types.ImageSliceData = getSliceData(viewport);
    const viewportData: InterpolationViewportData = {
      viewport,
      sliceData,
      annotation,
      interpolationUID: annotation.interpolationUID,
      isInterpolationUpdate: changeType === ChangeTypes.InterpolationUpdated,
    };
    interpolate(viewportData);
  };

  static handleAnnotationDelete = (evt: AnnotationRemovedEventType) => {
    const annotation = evt.detail.annotation as InterpolationROIAnnotation;
    if (!annotation?.metadata) {
      return;
    }
    const { toolName } = annotation.metadata;

    if (!this.toolNames.includes(toolName) || annotation.autoGenerated) {
      return;
    }
    const viewport = getViewportForAnnotation(annotation);

    if (!viewport) {
      console.warn(
        "No viewport, can't delete interpolated results",
        annotation
      );
      return;
    }

    const sliceData: Types.ImageSliceData = getSliceData(viewport);
    const viewportData: InterpolationViewportData = {
      viewport,
      sliceData,
      annotation,
      interpolationUID: annotation.interpolationUID,
    };
    // If any update, triggered on an annotation, then it will be treated as non-interpolated.
    annotation.autoGenerated = false;
    deleteRelatedAnnotations(viewportData);
  };
}

function getSliceData(viewport): Types.ImageSliceData {
  const sliceData: Types.ImageSliceData = {
    numberOfSlices: viewport.getNumberOfSlices(),
    imageIndex: viewport.getCurrentImageIdIndex(),
  };
  return sliceData;
}

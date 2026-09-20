import type { DiagramDef } from '../model';
import { applicationDiagram } from './application';
import { awsFlowDiagram } from './awsflow';
import { csdmQuiltDiagram } from './csdmquilt';
import { lifecycleDiagram } from './lifecycle';
import { overlayDiagram } from './overlay';
import { systemDiagram } from './system';

export const diagrams: DiagramDef[] = [
  systemDiagram,
  applicationDiagram,
  awsFlowDiagram,
  overlayDiagram,
  lifecycleDiagram,
  csdmQuiltDiagram,
];

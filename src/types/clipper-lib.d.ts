declare module 'clipper-lib' {
  namespace ClipperLib {
    interface IntPoint {
      X: number;
      Y: number;
    }

    class Path extends Array<IntPoint> {}

    class Paths extends Array<Path> {}

    enum JoinType {
      jtSquare = 0,
      jtRound = 1,
      jtMiter = 2,
    }

    enum EndType {
      etOpenSquare = 0,
      etOpenRound = 1,
      etOpenButt = 2,
      etClosedLine = 3,
      etClosedPolygon = 4,
    }

    class ClipperOffset {
      constructor(miterLimit?: number, arcTolerance?: number);
      AddPath(path: Path, joinType: JoinType, endType: EndType): void;
      AddPaths(paths: Paths, joinType: JoinType, endType: EndType): void;
      Clear(): void;
      Execute(solution: Paths, delta: number): void;
      MiterLimit: number;
      ArcTolerance: number;
    }
  }

  const ClipperLib: {
    Path: typeof ClipperLib.Path;
    Paths: typeof ClipperLib.Paths;
    ClipperOffset: typeof ClipperLib.ClipperOffset;
    JoinType: typeof ClipperLib.JoinType;
    EndType: typeof ClipperLib.EndType;
    JS: {
      ScaleUpPath(path: ClipperLib.Path, scale: number): void;
      ScaleDownPath(path: ClipperLib.Path, scale: number): void;
      ScaleUpPaths(paths: ClipperLib.Paths, scale: number): void;
      ScaleDownPaths(paths: ClipperLib.Paths, scale: number): void;
    };
  };

  export default ClipperLib;
}

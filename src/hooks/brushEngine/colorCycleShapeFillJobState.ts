export class ColorCycleShapeFillJobState {
  private concentricWorkerJobId = 0;

  beginConcentricWorkerJob(): number {
    this.concentricWorkerJobId += 1;
    return this.concentricWorkerJobId;
  }

  isCurrentConcentricWorkerJob(jobId: number): boolean {
    return jobId === this.concentricWorkerJobId;
  }
}

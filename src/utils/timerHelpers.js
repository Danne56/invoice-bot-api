/**
 * Timer Utility Functions
 * Helper functions for timer operations and formatting
 */

/**
 * Parse duration string to milliseconds
 * @param {string} duration - Duration string like "15s", "30m", "2h", "1d"
 * @returns {number} Duration in milliseconds
 */
function parseDuration(duration) {
  if (typeof duration !== 'string') {
    throw new Error('Duration must be a string');
  }

  // Remove whitespace and convert to lowercase
  const cleanDuration = duration.trim().toLowerCase();

  // Match pattern: number + unit (s, m, h, d)
  const match = cleanDuration.match(/^(\d+(?:\.\d+)?)(s|m|h|d)$/);

  if (!match) {
    throw new Error(
      'Invalid duration format. Use formats like: 15s, 30m, 2h, 1d'
    );
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (value <= 0) {
    throw new Error('Duration must be greater than 0');
  }

  // Convert to milliseconds
  switch (unit) {
    case 's': // seconds
      return Math.floor(value * 1000);
    case 'm': // minutes
      return Math.floor(value * 60 * 1000);
    case 'h': // hours
      return Math.floor(value * 60 * 60 * 1000);
    case 'd': // days
      return Math.floor(value * 24 * 60 * 60 * 1000);
    default:
      throw new Error(
        'Invalid duration unit. Use s (seconds), m (minutes), h (hours), or d (days)'
      );
  }
}

/**
 * Convert milliseconds to human-readable duration
 * @param {number} milliseconds - Time in milliseconds
 * @returns {string} Human-readable duration like "5 minutes 30 seconds"
 */
function formatDuration(milliseconds) {
  if (milliseconds <= 0) return '0 seconds';

  const totalSeconds = Math.floor(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (hours > 0) {
    parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
  }
  if (minutes > 0) {
    parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
  }
  if (seconds > 0 && hours === 0) {
    // Only show seconds if less than an hour
    parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);
  }

  if (parts.length === 0) return '0 seconds';
  if (parts.length === 1) return parts[0];
  if (parts.length === 2) return parts.join(' ');

  // For 3 parts (hours, minutes, seconds), join with commas
  return parts.slice(0, -1).join(', ') + ' ' + parts[parts.length - 1];
}

/**
 * Create relative time description
 * @param {number} timeRemaining - Time remaining in milliseconds
 * @param {boolean} isExpired - Whether the timer has expired
 * @returns {string} Relative time description
 */
function formatRelativeTime(timeRemaining, isExpired) {
  if (isExpired) {
    const overdue = Math.abs(timeRemaining);
    return `expired ${formatDuration(overdue)} ago`;
  }

  if (timeRemaining <= 60000) {
    // Less than 1 minute
    const seconds = Math.floor(timeRemaining / 1000);
    return `expires in ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
  }

  return `expires in ${formatDuration(timeRemaining)}`;
}

/**
 * Get timer status description
 * @param {number} timeRemaining - Time remaining in milliseconds
 * @returns {Object} Status object with description and type
 */
function getTimerStatus(timeRemaining) {
  if (timeRemaining <= 0) {
    return {
      status: 'expired',
      description: 'Timer has expired and webhook should have been called',
      urgency: 'high',
    };
  }

  if (timeRemaining <= 60000) {
    // Less than 1 minute
    return {
      status: 'expiring_soon',
      description: 'Timer will expire very soon',
      urgency: 'high',
    };
  }

  if (timeRemaining <= 300000) {
    // Less than 5 minutes
    return {
      status: 'active_urgent',
      description: 'Timer is active and will expire soon',
      urgency: 'medium',
    };
  }

  return {
    status: 'active',
    description: 'Timer is active and running normally',
    urgency: 'low',
  };
}

/**
 * Calculate timer statistics from job list
 * @param {Array} jobs - Array of job objects
 * @returns {Object} Statistics object
 */
function calculateTimerStats(jobs) {
  const now = Date.now();

  const enhancedJobs = jobs.map(job => {
    const timeRemaining = job.deadline - now;
    const isExpired = timeRemaining <= 0;
    const timerStatus = getTimerStatus(timeRemaining);

    return {
      ...job,
      deadlineISO: new Date(job.deadline).toISOString(),
      timeRemaining: Math.max(0, timeRemaining),
      timeRemainingFormatted: formatDuration(Math.max(0, timeRemaining)),
      timeDescription: formatRelativeTime(timeRemaining, isExpired),
      timerStatus: timerStatus.status,
      statusDescription: timerStatus.description,
      urgency: timerStatus.urgency,
      isExpired,
    };
  });

  const activeJobs = enhancedJobs.filter(job => !job.isExpired);
  const expiredJobs = enhancedJobs.filter(job => job.isExpired);
  const urgentJobs = activeJobs.filter(
    job => job.urgency === 'high' || job.urgency === 'medium'
  );

  // Find next expiring job
  const nextExpiringJob =
    activeJobs.length > 0
      ? activeJobs.reduce((earliest, job) =>
          job.deadline < earliest.deadline ? job : earliest
        )
      : null;

  return {
    enhancedJobs,
    summary: {
      total: jobs.length,
      active: activeJobs.length,
      expired: expiredJobs.length,
      urgent: urgentJobs.length,
      nextExpiring: nextExpiringJob
        ? {
            tripId: nextExpiringJob.tripId,
            timeRemaining: nextExpiringJob.timeRemainingFormatted,
            description: nextExpiringJob.timeDescription,
          }
        : null,
    },
    jobs: {
      active: activeJobs,
      expired: expiredJobs,
    },
  };
}

module.exports = {
  parseDuration,
  formatDuration,
  formatRelativeTime,
  getTimerStatus,
  calculateTimerStats,
};

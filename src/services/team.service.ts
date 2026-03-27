import { computeTier, TierType } from "./tier.service";

type Team = {
  teamId: number;
  members: string[];
};

export const generateTeams = async (clubId: string, teamCount: number, tierType: TierType) => {
  const computed = await computeTier(clubId, tierType);
  const sortedUsers = Object.entries(computed.scores)
    .sort((a, b) => b[1] - a[1])
    .map(([userId]) => userId);

  const teams: Team[] = Array.from({ length: teamCount }, (_, index) => ({
    teamId: index + 1,
    members: [],
  }));

  let direction = 1;
  let current = 0;

  for (const userId of sortedUsers) {
    const currentTeam = teams[current];
    if (!currentTeam) {
      continue;
    }
    currentTeam.members.push(userId);

    if (teamCount === 1) {
      continue;
    }

    if (direction === 1) {
      if (current === teamCount - 1) {
        direction = -1;
      } else {
        current += 1;
      }
    } else if (current === 0) {
      direction = 1;
    } else {
      current -= 1;
    }
  }

  return { teams };
};
